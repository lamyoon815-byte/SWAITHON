/**
 * 음성 인식 글자를 화면의 보기 중 하나로 맞춘다. "사십오", "45", "사십 오", "45번" 모두 45로 본다.
 * "안 보여요·모르겠어요·없어요"는 "숫자가 안 보여요" 보기로. 맞는 보기가 없으면 null.
 */

const DIGITS: Record<string, number> = { 영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9 };

/** 한자어 수(0~99). "사십오" → 45, "구" → 9. 수가 아닌 글자가 섞이면 null. */
function sinoKorean(word: string): number | null {
  if (!word) return null;
  const at = word.indexOf('십');
  if (at === -1) return word.length === 1 && word in DIGITS ? DIGITS[word] : null;
  const tens = word.slice(0, at);
  const ones = word.slice(at + 1);
  const t = tens === '' ? 1 : tens.length === 1 && tens in DIGITS ? DIGITS[tens] : null;
  const o = ones === '' ? 0 : ones.length === 1 && ones in DIGITS ? DIGITS[ones] : null;
  return t === null || o === null ? null : t * 10 + o;
}

export function spokenNumbers(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/\d+/g)) found.push(String(Number(m[0])));
  // 숫자 사이 띄어쓰기("사십 오")를 붙여서 읽고, 한글 수 덩어리만 골라낸다.
  const hangul = text.replace(/\s+/g, '').match(/[영공일이삼사오육륙칠팔구십]+/g) ?? [];
  for (const chunk of hangul) {
    // "구십칠이"(구십칠 + 조사 '이')처럼 뒤에 붙은 글자가 있으니, 앞에서부터 가장 긴 수를 읽어 나간다.
    let i = 0;
    while (i < chunk.length) {
      let read = 0;
      for (let length = Math.min(4, chunk.length - i); length > 0; length--) {
        const value = sinoKorean(chunk.slice(i, i + length));
        if (value !== null) { found.push(String(value)); read = length; break; }
      }
      i += read || 1;
    }
  }
  return found;
}

export function matchSpokenChoice(text: string, choices: string[]): string | null {
  const numbers = spokenNumbers(text);
  const numeric = choices.find((choice) => /^\d+$/.test(choice) && numbers.includes(String(Number(choice))));
  if (numeric) return numeric;
  if (/안\s*보|모르|없|못\s*보|잘\s*모/.test(text)) return choices.find((choice) => !/^\d+$/.test(choice)) ?? null;
  return null;
}
