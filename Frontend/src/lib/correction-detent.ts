/** 0(대비 내부값 1) 근처에서 잡고, 더 멀리 움직이면 놓는 히스테리시스. */
export function correctionDetent(raw: number, previous: number, latched: boolean, neutral: number, step: number) {
  const distance = Math.abs(raw - neutral);
  const crossed = (previous - neutral) * (raw - neutral) < 0;
  const nextLatched = latched
    ? distance <= step * 2 + 1e-8
    : distance <= step + 1e-8 || crossed;
  return { value: nextLatched ? neutral : raw, latched: nextLatched, entered: nextLatched && !latched };
}
