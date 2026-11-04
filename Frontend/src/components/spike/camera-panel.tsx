/**
 * Spike: expo-camera 권한 → 미리보기 → 촬영 → 1024px 리사이즈 → (설정 시) 업로드.
 * 배터리와 권한 팝업 때문에 버튼을 눌렀을 때만 카메라를 켠다.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Image, StyleSheet, View } from 'react-native';

import { BigButton } from '@/components/common/big-button';
import { InfoText, Row, Section } from '@/components/spike/section';
import type { Palette } from '@/constants/a11y';
import { fileSize, kb, resizeLongSide, uploadImage } from '@/lib/resize';

export function CameraPanel({ palette }: { palette: Palette }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const cameraRef = useRef<CameraView>(null);

  const openCamera = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        setLines(['카메라 권한이 거부됨 — 설정 > Expo Go > 카메라에서 허용']);
        return;
      }
    }
    setReady(false);
    setOpen(true);
  };

  const capture = async () => {
    if (!cameraRef.current) return;
    setBusy(true);
    const out: string[] = [];
    try {
      const t0 = performance.now();
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      out.push(
        `촬영 ${photo.width}×${photo.height}, ${kb(fileSize(photo.uri))}, ${Math.round(performance.now() - t0)}ms`,
      );
      const result = await resizeLongSide(photo.uri, photo.width, photo.height);
      out.push(`리사이즈 ${result.width}×${result.height}, ${kb(fileSize(result.uri))}, ${result.ms}ms`);
      out.push(await uploadImage(result.uri));
      setPhotoUri(result.uri);
      setOpen(false);
      AccessibilityInfo.announceForAccessibility('촬영 완료');
    } catch (e) {
      out.push(`오류: ${(e as Error).message}`);
    }
    setLines(out);
    setBusy(false);
  };

  return (
    <Section title="6. 카메라 촬영 (expo-camera)" palette={palette}>
      {open ? (
        <>
          <View style={[styles.preview, { borderColor: palette.border }]}>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing="back"
              autofocus="on"
              onCameraReady={() => setReady(true)}
              accessibilityLabel="카메라 미리보기"
            />
          </View>
          <Row>
            <BigButton
              label={busy ? '처리 중…' : ready ? '촬영' : '준비 중…'}
              onPress={capture}
              palette={palette}
              disabled={!ready || busy}
            />
            <BigButton label="닫기" onPress={() => setOpen(false)} palette={palette} selected={false} />
          </Row>
        </>
      ) : (
        <Row>
          <BigButton label={photoUri ? '다시 찍기' : '카메라 켜기'} onPress={openCamera} palette={palette} />
        </Row>
      )}
      {photoUri && !open && (
        <Image
          source={{ uri: photoUri }}
          style={[styles.preview, { borderColor: palette.border }]}
          resizeMode="contain"
          accessibilityLabel="방금 촬영한 사진 (1024px로 줄인 것)"
        />
      )}
      {lines.map((line) => (
        <InfoText key={line} palette={palette}>
          {line}
        </InfoText>
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  preview: {
    height: 280,
    borderWidth: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
});
