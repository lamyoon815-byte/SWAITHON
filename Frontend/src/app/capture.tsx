// 와이어프레임 1-2 QR 스캔 (`?mode=qr`) · 4 촬영 인식 (`?mode=artwork`). 탭 바 없는 전체 화면
/**
 * 위에서부터 안내 문구 → 점선 가이드가 있는 카메라(남는 높이를 전부 씀) → 팁 세 칸 → 큰 버튼.
 * 카메라 화면은 테마와 상관없이 항상 어둡게 둔다 (미리보기에 눈이 가도록).
 * 두 모드 모두 QR이 보이면 바로 인식한다. 인식된 작품의 미술관이 현재 미술관이 된다.
 * 미등록 작품은 탭 바 없는 실패 화면으로, 일시적인 QR 읽기 오류는 미리보기 안의 안내로 표시한다.
 * 빨강은 아이콘과 테두리에만 쓴다 (적색약에게 빨간 글씨는 어둡게 보이고, 카메라 화면 위에서는 대비가 들쭉날쭉하다).
 * 작품 촬영은 `/recognize/artwork`의 next_action으로 이동·후보 확인·미등록 분석·재촬영을 나눈다.
 */

import { Image } from 'expo-image';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/common/back-button';
import { showToast } from '@/components/common/toast';
import { ButtonHeight, ButtonRadius, FontSize, MinTouchTarget, getPalette, type Palette } from '@/constants/a11y';
import { Scrim, ScreenPadding, Spacing } from '@/constants/theme';
import { useSettings } from '@/hooks/use-settings';
import { API_URL, ApiError, getArtwork, getMuseums, recognizeArtwork, analyzeArtwork, type RecognitionResult, type AnalysisResult } from '@/lib/api';
import { resizeLongSide } from '@/lib/resize';
import { speakKorean } from '@/lib/speech';
import type { CaptureMode } from '@/types/capture';

const QR_PREFIX = 'swaithon://artwork/';
/** The same QR stays in view for a while; ignore repeats for this long. */
const RESCAN_MS = 3000;

type Tip = { text: string; ios: SFSymbol; material: AndroidSymbol };
type ScanError = { title: string; detail: string };

const LOAD_FAILED: ScanError = {
  title: '작품 정보를 불러오지 못했어요',
  detail: '잠시 후 다시 비춰 주세요',
};

const COPY: Record<CaptureMode, { title: string; guide: string; tips: Tip[] }> = {
  qr: {
    title: 'QR 코드 스캔',
    guide: 'QR 코드를 사각형 안에\n맞춰 주세요',
    tips: [
      { text: '사각형에\n맞춰 주세요', ios: 'qrcode.viewfinder', material: 'center_focus_strong' },
      { text: '조금 떨어져\n비춰 주세요', ios: 'arrow.up.left.and.arrow.down.right', material: 'open_in_full' },
      { text: '밝은 곳에서\n비춰 주세요', ios: 'sun.max.fill', material: 'wb_sunny' },
    ],
  },
  artwork: {
    title: '작품 촬영',
    guide: '작품 전체가 사각형 안에\n들어오게 찍어 주세요',
    tips: [
      { text: '작품 전체를\n담아 주세요', ios: 'photo.artframe', material: 'image' },
      { text: '흔들림과\n빛 반사 주의', ios: 'sun.max.fill', material: 'wb_sunny' },
      { text: 'QR이 보이면\n바로 찾아요', ios: 'qrcode', material: 'qr_code' },
    ],
  },
};

/** QR 내용 형식은 BE와 합의 전이라 딥링크와 id 문자열을 둘 다 받는다 (README 9장 BE 요청 1번). */
function parseArtworkQr(data: string) {
  const text = data.trim();
  const id = text.startsWith(QR_PREFIX) ? text.slice(QR_PREFIX.length) : text;
  return id.length > 0 && id.length <= 64 ? id : null;
}

export default function CaptureScreen() {
  // Camera screens stay dark in every theme; only high contrast would change this.
  const palette = getPalette('dark', false);
  const { mode: rawMode } = useLocalSearchParams<{ mode?: string }>();
  const mode: CaptureMode = rawMode === 'qr' ? 'qr' : 'artwork';
  const copy = COPY[mode];
  const [permission, requestPermission] = useCameraPermissions();
  const { updateSettings } = useSettings();
  const cameraRef = useRef<CameraView>(null);
  const scanLock = useRef(false);
  const [recognition, setRecognition] = useState<RecognitionResult | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState(false);
  const [scanError, setScanError] = useState<ScanError | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(errorTimer.current);
      Speech.stop();
    },
    [],
  );

  /** Card stays up exactly as long as the same QR is ignored, then scanning resumes. */
  const showScanError = async (error: ScanError) => {
    clearTimeout(errorTimer.current);
    setScanError(error);
    errorTimer.current = setTimeout(() => setScanError(null), RESCAN_MS);
    const message = `${error.title}. ${error.detail}`;
    // Let the screen reader speak when it is on, so the two voices don't overlap.
    if (await AccessibilityInfo.isScreenReaderEnabled()) {
      AccessibilityInfo.announceForAccessibility(message);
    } else {
      Speech.stop();
      void speakKorean(message);
    }
  };

  const onBarcode = async ({ data }: BarcodeScanningResult) => {
    if (scanLock.current || busy || recognition || analysis) return;
    const id = parseArtworkQr(data);
    if (!id) return;
    scanLock.current = true;
    setTimeout(() => (scanLock.current = false), RESCAN_MS);
    try {
      const artwork = await getArtwork(id);
      const museum = (await getMuseums()).find((m) => m.id === artwork.museum_id);
      await updateSettings({ recent_museum_id: artwork.museum_id });
      // Leave the camera off the back stack: back from the artwork goes to the list, not here.
      router.dismissAll();
      router.push({ pathname: '/artwork/[id]', params: { id: artwork.id } });
      showToast(museum ? `작품을 찾았어요. 현재 미술관: ${museum.name}` : '작품을 찾았어요', 'success');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        router.replace({ pathname: '/not-found', params: { mode } });
        return;
      }
      showScanError(LOAD_FAILED);
    }
  };

  /** 인식된 작품의 미술관을 현재 미술관으로 정하고, 카메라를 닫고 작품 감상(2)으로 간다. */
  const openRecognized = async (id: string) => {
    const artwork = await getArtwork(id);
    const museum = (await getMuseums()).find((m) => m.id === artwork.museum_id);
    setRecognition(null);
    if (artwork.museum_id) await updateSettings({ recent_museum_id: artwork.museum_id });
    router.dismissAll();
    router.push({ pathname: '/artwork/[id]', params: { id: artwork.id } });
    showToast(museum ? `작품을 찾았어요. 현재 미술관: ${museum.name}` : '작품을 찾았어요', 'success');
  };

  /**
   * 촬영 → 긴 변 1024px로 줄여 `/recognize/artwork` → 서버의 next_action 처리.
   * 셔터 실패와 인식 실패를 나눠 안내한다. 촬영이 끝났으면 "사진을 찍지 못했어요"는 쓰지 않는다.
   */
  const capture = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      let photo;
      try {
        photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      } catch {
        showToast('사진을 찍지 못했어요. 다시 눌러 주세요', 'error');
        return;
      }
      if (!API_URL) {
        showToast('작품 인식은 서버 연결 후에 동작해요', 'warning');
        return;
      }
      showToast('작품을 분석하고 있어요');
      // 실패 단계와 원인은 개발 모드(Expo Go)에서만 토스트에 붙인다. 배포 빌드에서는 문구만 보인다.
      let stage = '사진 줄이기';
      try {
        const resized = await resizeLongSide(photo.uri, photo.width, photo.height);
        stage = '서버 전송';
        const result = await recognizeArtwork(resized.uri);
        setPhotoUri(resized.uri);
        void speakKorean(result.message);
        if (result.next_action === 'show_artwork' && result.candidates[0]) {
          stage = '작품 열기';
          await openRecognized(result.candidates[0].artwork_id);
        } else if (result.next_action === 'retake') {
          await showScanError({ title: '다시 촬영해 주세요', detail: result.message });
        } else {
          setRecognition(result);
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.warn(`[capture] 작품 인식 실패 (${stage})`, API_URL, e);
        showToast(
          e instanceof ApiError && (e.status === 429 || e.status === 503)
            ? '서버가 바빠요. 잠시 후 다시 찍어 주세요'
            : `해당 작품의 정보를 불러올 수 없어요. 다시 찍어 주세요${__DEV__ ? ` [${stage}: ${detail}]` : ''}`,
          'error',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const closeResult = () => {
    if (busy) return;
    setRecognition(null);
    setAnalysis(null);
    setPhotoUri(null);
    Speech.stop();
  };

  const analyzePhoto = async () => {
    if (!photoUri || busy) return;
    setBusy(true);
    try {
      const result = await analyzeArtwork(photoUri);
      setAnalysis(result);
      setRecognition(null);
      if (!result.fallback) {
        void speakKorean([result.warning, ...result.description.facts,
          ...result.description.interpretations.map((text) => `가능한 감정적 해석입니다. ${text}`)].join(' '));
      }
    } catch (error) {
      const message = error instanceof ApiError
        ? error.message
        : 'AI 해설을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
      // Keep the photo and result so the user can retry without taking another photo.
      await showScanError({ title: 'AI 해설을 불러오지 못했어요', detail: message });
      showToast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  // Swap the camera for the search screen, so back from search does not reopen the camera.
  const goToNumber = () => router.replace('/search');

  const granted = !!permission?.granted;
  const blocked = !!permission && !permission.granted && !permission.canAskAgain;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <Modal visible={!!recognition || !!analysis} animationType="slide" onRequestClose={closeResult}>
        <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
          <ScrollView contentContainerStyle={styles.resultContent}>
            <Text accessibilityRole="header" style={[styles.headerTitle, { color: palette.text }]}>
              {analysis ? 'AI 작품 해설' : recognition?.next_action === 'analyze' ? '미등록 작품' : '찍은 작품이 맞나요?'}
            </Text>
            <Text accessibilityLiveRegion="polite" style={[styles.resultText, { color: palette.text }]}>
              {analysis ? analysis.warning : recognition?.message}
            </Text>
            {recognition?.candidates.map((candidate) => (
              <Pressable key={candidate.artwork_id} accessibilityRole="button"
                accessibilityLabel={`${candidate.title}, ${candidate.artist}, 이 작품 선택`}
                disabled={busy}
                onPress={async () => {
                  setBusy(true);
                  try { await openRecognized(candidate.artwork_id); }
                  catch { showToast('작품 정보를 불러오지 못했어요. 다시 선택해 주세요', 'error'); }
                  finally { setBusy(false); }
                }}
                style={[styles.candidate, { borderColor: palette.textSecondary }]}>
                <Image source={{ uri: candidate.image_url }} style={styles.candidateImage} contentFit="contain" />
                <Text style={[styles.resultText, { color: palette.text }]}>{candidate.title}</Text>
                <Text style={[styles.errorDetail, { color: palette.textSecondary }]}>{candidate.artist}</Text>
              </Pressable>
            ))}
            {recognition && photoUri ? (
              <BottomButton label={busy ? '분석 중…' : '이 사진으로 AI 해설 듣기'} palette={palette}
                disabled={busy} onPress={analyzePhoto} />
            ) : null}
            {analysis ? (
              <>
                <Text style={[styles.resultText, { color: palette.textSecondary }]}>
                  {analysis.fallback ? '해설 생성에 실패했어요. 다시 촬영해 주세요.' : 'AI가 생성한 미검수 해설이에요.'}
                </Text>
                {analysis.description.facts.map((text, i) => (
                  <Text key={`fact-${i}`} style={[styles.resultText, { color: palette.text }]}>{text}</Text>
                ))}
                {!analysis.fallback && analysis.description.interpretations.map((text, i) => (
                  <Text key={`interpretation-${i}`} style={[styles.resultText, { color: palette.text }]}>
                    가능한 감정적 해석입니다. {text}
                  </Text>
                ))}
              </>
            ) : null}
            <BottomButton label="다시 촬영하기" palette={palette} secondary disabled={busy} onPress={closeResult} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <View style={styles.header}>
        <BackButton label="닫기" palette={palette} />
        <Text accessibilityRole="header" style={[styles.headerTitle, { color: palette.text }]}>
          {copy.title}
        </Text>
      </View>

      <Text style={[styles.guide, { color: palette.text }]}>{copy.guide}</Text>

      <View style={[styles.viewport, { backgroundColor: palette.fill }]}>
        {granted ? (
          <>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing="back"
              autofocus="on"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onBarcode}
              onCameraReady={() => setReady(true)}
              accessibilityLabel="카메라 화면"
            />
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.frame,
                mode === 'qr' ? styles.frameQr : styles.frameArtwork,
                { borderColor: palette.text },
              ]}
            />
            {scanError ? (
              <View pointerEvents="none" style={styles.errorLayer}>
                <View
                  accessibilityRole="alert"
                  accessibilityLiveRegion="assertive"
                  style={[styles.errorCard, { backgroundColor: palette.background, borderColor: palette.danger }]}>
                  <SymbolView
                    name={{ ios: 'exclamationmark.circle.fill', android: 'error', web: 'error' }}
                    size={44}
                    tintColor={palette.danger}
                  />
                  <Text style={[styles.errorTitle, { color: palette.text }]}>{scanError.title}</Text>
                  <Text style={[styles.errorDetail, { color: palette.textSecondary }]}>
                    {scanError.detail}
                  </Text>
                </View>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel="플래시"
              accessibilityState={{ checked: torch }}
              onPress={() => setTorch((v) => !v)}
              style={({ pressed }) => [
                styles.torch,
                {
                  backgroundColor: torch ? palette.highlight : Scrim,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}>
              <SymbolView
                name={{ ios: 'flashlight.on.fill', android: 'flashlight_on', web: 'flashlight_on' }}
                size={26}
                tintColor={torch ? palette.highlightText : palette.text}
              />
            </Pressable>
          </>
        ) : (
          <View style={styles.permission}>
            <Text style={[styles.permissionText, { color: palette.text }]}>
              {blocked
                ? '카메라 권한이 꺼져 있어요.\n설정에서 카메라를 허용해 주세요'
                : '작품을 찾으려면 카메라 권한이 필요해요'}
            </Text>
            <BottomButton
              label={blocked ? '설정 열기' : '카메라 켜기'}
              palette={palette}
              onPress={blocked ? () => Linking.openSettings() : requestPermission}
            />
          </View>
        )}
      </View>

      <View style={[styles.tips, { borderColor: palette.fill }]}>
        {copy.tips.map((tip) => (
          <View key={tip.text} style={styles.tip}>
            <View style={[styles.tipIcon, { backgroundColor: palette.fill }]}>
              <SymbolView
                name={{ ios: tip.ios, android: tip.material, web: tip.material }}
                size={26}
                tintColor={palette.text}
              />
            </View>
            <Text style={[styles.tipText, { color: palette.text }]}>{tip.text}</Text>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        {mode === 'artwork' ? (
          <BottomButton
            label={busy ? '찍는 중…' : '촬영'}
            a11yLabel="촬영해서 작품 찾기"
            palette={palette}
            disabled={!granted || !ready || busy}
            onPress={capture}
          />
        ) : (
          <BottomButton label="번호로 찾기" palette={palette} secondary onPress={goToNumber} />
        )}
      </View>
    </SafeAreaView>
  );
}

type BottomButtonProps = {
  label: string;
  a11yLabel?: string;
  palette: Palette;
  secondary?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

function BottomButton({ label, a11yLabel, palette, secondary, disabled, onPress }: BottomButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: secondary ? palette.fill : palette.accent,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}>
      <Text style={[styles.buttonText, { color: secondary ? palette.text : palette.accentText }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  resultContent: { padding: ScreenPadding, gap: Spacing.three },
  resultText: { fontSize: FontSize.label, lineHeight: 30 },
  candidate: { borderWidth: 2, borderRadius: 20, padding: Spacing.three, gap: Spacing.two },
  candidateImage: { width: '100%', height: 180 },
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: ScreenPadding,
    paddingVertical: Spacing.two,
  },
  headerTitle: {
    fontSize: FontSize.body,
    fontWeight: 800,
  },
  guide: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    fontSize: 22,
    fontWeight: 700,
    lineHeight: 32,
    textAlign: 'center',
  },
  // Full width and every pixel of height the rest leaves: the bigger the preview, the easier
  // it is for low-vision users to frame the artwork.
  viewport: {
    flex: 1,
    minHeight: 280,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    position: 'absolute',
    borderWidth: 3,
    borderStyle: 'dashed',
    borderRadius: 16,
  },
  frameQr: {
    width: '62%',
    aspectRatio: 1,
  },
  frameArtwork: {
    width: '84%',
    height: '84%',
  },
  errorLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  // Opaque so the text reads the same over any camera image.
  errorCard: {
    maxWidth: 320,
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    borderWidth: 3,
    borderRadius: 20,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: 800,
    lineHeight: 30,
    textAlign: 'center',
  },
  errorDetail: {
    fontSize: 17,
    fontWeight: 600,
    lineHeight: 24,
    textAlign: 'center',
  },
  torch: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.three,
    width: MinTouchTarget,
    height: MinTouchTarget,
    borderRadius: MinTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permission: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  permissionText: {
    fontSize: FontSize.label,
    fontWeight: 600,
    lineHeight: 26,
    textAlign: 'center',
  },
  tips: {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    paddingVertical: Spacing.three,
    borderWidth: 1,
    borderRadius: 20,
  },
  tip: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.two,
  },
  tipIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipText: {
    fontSize: 16,
    fontWeight: 600,
    lineHeight: 22,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: ScreenPadding,
    paddingVertical: Spacing.three,
  },
  // Minimum, not fixed: a fixed height clips the label at the largest system text size.
  button: {
    alignSelf: 'stretch',
    minHeight: ButtonHeight,
    paddingVertical: 10,
    paddingHorizontal: Spacing.three,
    borderRadius: ButtonRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: FontSize.button,
    fontWeight: 800,
  },
});
