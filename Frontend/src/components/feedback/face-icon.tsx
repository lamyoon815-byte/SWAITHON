/**
 * 만족도 표정 아이콘(선 그림 한 가지 색). 색각이상 사용자를 위해 색이 아니라 입 모양으로만 구분한다.
 * good = 웃는 입(아래로 둥근 곡선), okay = 일자 입, bad = 처진 입(위로 둥근 곡선).
 * 별도 그림 라이브러리 없이 원·점·반원 View로 그린다. 장식이라 스크린리더는 읽지 않는다(버튼 글자가 이름).
 */

import { StyleSheet, View } from 'react-native';

export type Face = 'good' | 'okay' | 'bad';

type Props = { face: Face; color: string; size?: number };

export function FaceIcon({ face, color, size = 36 }: Props) {
  const stroke = Math.max(2, Math.round(size * 0.085));
  // 테두리 안쪽 영역 기준으로 위치를 계산한다(절대 위치는 테두리 안쪽에서 시작).
  const inner = size - stroke * 2;
  const eye = Math.round(size * 0.13);
  const eyeTop = inner * 0.26;
  const eyeSide = inner * 0.24;
  const mouth = Math.round(inner * 0.5);
  const half = mouth / 2;
  const mouthLeft = (inner - mouth) / 2;
  const dot = { width: eye, height: eye, borderRadius: eye / 2, backgroundColor: color, top: eyeTop };
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderColor: color }}>
      <View style={[styles.abs, dot, { left: eyeSide }]} />
      <View style={[styles.abs, dot, { right: eyeSide }]} />
      {face === 'okay' ? (
        <View style={[styles.abs, {
          left: mouthLeft, width: mouth, top: inner * 0.62, height: stroke, borderRadius: stroke / 2, backgroundColor: color,
        }]} />
      ) : (
        // 원의 아래 절반(웃음) 또는 위 절반(처짐)만 보이게 잘라 입을 그린다.
        <View style={[styles.abs, styles.clip, { left: mouthLeft, width: mouth, height: half, top: face === 'good' ? inner * 0.48 : inner * 0.6 }]}>
          <View style={{
            width: mouth, height: mouth, borderRadius: half, borderWidth: stroke, borderColor: color,
            marginTop: face === 'good' ? -half : 0,
          }} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  clip: { overflow: 'hidden' },
});
