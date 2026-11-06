// 와이어프레임 1-2 QR 스캔 · 4 촬영 인식 (디자인 "저시력 미술관 앱"의 카메라 탭)
/**
 * 작품 찾기: QR은 비추기만 하면 자동 인식, 작품은 셔터로 촬영한다.
 * 카메라는 이 탭이 보일 때만 켜서 배터리를 아끼고, 다른 탭에서 계속 찍히지 않게 한다.
 * 인식된 작품의 미술관이 자동으로 현재 미술관이 되고, 작품 감상(2)으로 바로 간다 (디자인의 미술관 결정 규칙).
 * 촬영본은 긴 변 1024px JPEG로 줄여 `/recognize`로 보낸다 (README 6.3). 로그인 없이 호출한다.
 * TODO(B): medium이면 4-1 후보 확인 시트, 없는 작품이면 1-3으로 보내기. 지금은 첫 후보로 바로 간다.
 */

import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router, useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/common/big-button';
import { showToast } from '@/components/common/toast';
import { FontSize, MinTouchTarget, getPalette, type Palette } from '@/constants/a11y';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSettings } from '@/hooks/use-settings';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { API_URL, ApiError, getArtwork, getMuseums, recognizeArtwork } from '@/lib/api';
import { resizeLongSide } from '@/lib/resize';

const QR_PREFIX = 'swaithon://artwork/';
/** expo-camera zoom is 0–1 and device dependent; 0.1 is roughly 2× on current phones. */
const ZOOM_IN = 0.1;
/** The same QR stays in view for a while; ignore repeats for this long. */
const RESCAN_MS = 3000;

/** QR 내용 형식은 BE와 합의 전이라 딥링크와 id 문자열을 둘 다 받는다 (README 9장 BE 요청 1번). */
function parseArtworkQr(data: string) {
  const text = data.trim();
  const id = text.startsWith(QR_PREFIX) ? text.slice(QR_PREFIX.length) : text;
  return id.length > 0 && id.length <= 64 ? id : null;
}

export default function CameraScreen() {
  const palette = getPalette(useColorScheme() === 'dark' ? 'dark' : 'light', false);
  const bottomInset = useTabBarInset();
  const focused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const scanLock = useRef(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const { updateSettings } = useSettings();

  // Leaving the tab unmounts the camera: turn the torch off and wait for onCameraReady again.
  useEffect(() => {
    if (!focused) return;
    return () => {
      setTorch(false);
      setReady(false);
    };
  }, [focused]);

  /** 인식된 작품의 미술관을 현재 미술관으로 정하고 작품 감상(2)으로 간다. */
  const openArtwork = async (id: string) => {
    const artwork = await getArtwork(id);
    const museum = (await getMuseums()).find((m) => m.id === artwork.museum_id);
    if (artwork.museum_id) await updateSettings({ recent_museum_id: artwork.museum_id });
    router.push({ pathname: '/artwork/[id]', params: { id: artwork.id } });
    showToast(museum ? `작품을 찾았어요 · 현재 미술관: ${museum.name}` : '작품을 찾았어요');
  };

  const onBarcode = async ({ data }: BarcodeScanningResult) => {
    if (scanLock.current) return;
    const id = parseArtworkQr(data);
    if (!id) return;
    scanLock.current = true;
    setTimeout(() => (scanLock.current = false), RESCAN_MS);
    try {
      await openArtwork(id);
    } catch (e) {
      showToast(
        e instanceof ApiError && e.status === 404
          ? '등록되지 않은 QR 코드예요'
          : '작품 정보를 불러오지 못했어요. 다시 비춰 주세요',
      );
    }
  };

  /**
   * 촬영 → 서버에서 등록 작품 사진과 유사도 비교 → 첫 후보 작품으로 이동.
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
        showToast('사진을 찍지 못했어요. 다시 눌러 주세요');
        return;
      }
      if (!API_URL) {
        showToast('사진을 찍었어요 · 작품 인식은 서버 연결 후에 동작해요');
        return;
      }
      showToast('작품을 분석하고 있어요');
      // 실패 단계와 원인은 개발 모드(Expo Go)에서만 토스트에 붙인다. 배포 빌드에서는 문구만 보인다.
      let stage = '사진 줄이기';
      try {
        const resized = await resizeLongSide(photo.uri, photo.width, photo.height);
        stage = '서버 전송';
        const result = await recognizeArtwork(resized.uri);
        const best = result.candidates[0];
        if (!best) {
          showToast('등록된 작품을 찾지 못했어요. 작품 전체가 보이게 다시 찍어 주세요');
          return;
        }
        stage = '작품 열기';
        await openArtwork(best.artwork_id);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.warn(`[camera] 작품 인식 실패 (${stage})`, API_URL, e);
        showToast(
          e instanceof ApiError && (e.status === 429 || e.status === 503)
            ? '서버가 바빠요. 잠시 후 다시 찍어 주세요'
            : `해당 작품의 정보를 불러올 수 없어요. 다시 찍어 주세요${__DEV__ ? ` [${stage}: ${detail}]` : ''}`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const granted = !!permission?.granted;
  const blocked = !!permission && !permission.granted && !permission.canAskAgain;

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.content, { paddingBottom: bottomInset }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
          작품 찾기
        </Text>

        <View style={[styles.preview, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {granted && focused ? (
            <>
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
                autofocus="on"
                enableTorch={torch}
                zoom={zoomed ? ZOOM_IN : 0}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={onBarcode}
                onCameraReady={() => setReady(true)}
                accessibilityLabel="카메라 화면"
              />
              <Chip
                side="left"
                label="⚡"
                a11yLabel={torch ? '플래시 끄기' : '플래시 켜기'}
                on={torch}
                onPress={() => setTorch((v) => !v)}
                palette={palette}
              />
              <Chip
                side="right"
                label={zoomed ? '2×' : '1×'}
                a11yLabel={zoomed ? '확대 끄기' : '2배 확대'}
                on={zoomed}
                onPress={() => setZoomed((v) => !v)}
                palette={palette}
              />
            </>
          ) : (
            <View style={styles.permission}>
              <Text style={[styles.guide, { color: palette.text }]}>
                {blocked
                  ? '카메라 권한이 꺼져 있어요. 설정에서 카메라를 허용해 주세요'
                  : '작품을 찾으려면 카메라 권한이 필요해요'}
              </Text>
              <BigButton
                label={blocked ? '설정 열기' : '카메라 켜기'}
                onPress={blocked ? () => Linking.openSettings() : requestPermission}
                palette={palette}
              />
            </View>
          )}
        </View>

        <Text style={[styles.guide, { color: palette.textSecondary }]}>
          작품이나 QR 코드를 화면에 담아 주세요
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="촬영해서 작품 찾기"
          accessibilityState={{ disabled: !ready || busy, busy }}
          disabled={!ready || busy}
          onPress={capture}
          style={({ pressed }) => [
            styles.shutter,
            {
              borderColor: palette.highlight,
              backgroundColor: palette.background,
              opacity: !ready ? 0.4 : pressed || busy ? 0.7 : 1,
            },
          ]}>
          <View style={[styles.shutterInner, { backgroundColor: palette.text }]} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

type ChipProps = {
  side: 'left' | 'right';
  label: string;
  a11yLabel: string;
  on: boolean;
  onPress: () => void;
  palette: Palette;
};

function Chip({ side, label, a11yLabel, on, onPress, palette }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        side === 'left' ? styles.chipLeft : styles.chipRight,
        {
          backgroundColor: on ? palette.highlight : 'rgba(0,0,0,0.55)',
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      <Text style={[styles.chipText, { color: on ? palette.highlightText : '#FFFFFF' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
  },
  title: {
    fontSize: FontSize.heading,
    fontWeight: 800,
  },
  preview: {
    width: '100%',
    aspectRatio: 1,
    flexShrink: 1,
    borderRadius: 40,
    borderWidth: 2,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  permission: {
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  guide: {
    fontSize: FontSize.label,
    fontWeight: 600,
    lineHeight: 26,
    textAlign: 'center',
  },
  chip: {
    position: 'absolute',
    top: Spacing.three,
    width: MinTouchTarget,
    height: MinTouchTarget,
    borderRadius: MinTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLeft: {
    left: Spacing.three,
  },
  chipRight: {
    right: Spacing.three,
  },
  chipText: {
    fontSize: FontSize.label,
    fontWeight: 800,
  },
  shutter: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 5,
    padding: 5,
  },
  shutterInner: {
    flex: 1,
    borderRadius: 40,
  },
});
