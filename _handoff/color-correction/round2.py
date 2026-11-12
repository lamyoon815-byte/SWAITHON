import sys, numpy as np, cv2
from PIL import Image
sys.path.insert(0, "Backend")
from ai.correction import srgb_to_linear, linear_to_srgb, cvd_matrix, ERROR_SHIFT

# --- 새 청색약 행렬 검증 (Viénot 1999 RGB→LMS)
LMS = np.array([[17.8824,43.5161,4.11935],[3.45565,27.1554,3.86714],[0.0299566,0.184309,1.46709]])
NEW_T = np.array([[0.0262,0.1612,1.2830],[-0.0068,-0.0417,-0.3317],[0.0003,0.0019,0.0155]])
d = LMS @ NEW_T  # 오차 e가 LMS에 주는 변화 = d @ e
print("새 행렬 검증: 계수(rank)", np.linalg.matrix_rank(NEW_T, tol=1e-3),
      "| 열 비율 vs S행 비율", np.round(NEW_T[0]/NEW_T[0,0],2), np.round(LMS[2]/LMS[2,0],2))
col = d[:, 2] / np.abs(d[:, 2]).max()
print(f"  LMS 변화 방향 (L, M, S) = {np.round(col,3)}  → L+M = {col[0]+col[1]:+.3f} (0이면 휘도 유지)")

# --- 독립 평가 모델
VIENOT = {"protan": np.array([[0.11238,0.88762,0],[0.11238,0.88762,0],[0.00401,-0.00401,1]]),
          "deutan": np.array([[0.29275,0.70725,0],[0.29275,0.70725,0],[-0.02234,0.02234,1]])}
BN = np.array([0.03901,-0.02788,-0.01113])
BA = np.array([[1.01277,0.13548,-0.14826],[-0.01243,0.86812,0.14431],[0.07589,0.80500,0.11911]])
BB = np.array([[0.93678,0.18979,-0.12657],[0.06154,0.81526,0.12320],[-0.37562,1.12767,0.24796]])
def indep(rgb, t):
    lin = srgb_to_linear(np.clip(rgb,0,1)).astype(np.float64)
    if t == "tritan":
        out = np.where((lin @ BN >= 0)[...,None], lin @ BA.T, lin @ BB.T)
    else:
        out = lin @ VIENOT[t].T
    return linear_to_srgb(np.clip(out,0,1).astype(np.float32))
def machado(rgb, t):
    lin = srgb_to_linear(rgb); return linear_to_srgb(np.clip(lin @ cvd_matrix(t,1.0).T,0,1))

def lab(rgb): return cv2.cvtColor(np.clip(rgb,0,1).astype(np.float32), cv2.COLOR_RGB2LAB)
def pairs(rgb):
    L = lab(rgb); return np.linalg.norm(L[:,1:]-L[:,:-1],axis=2), np.linalg.norm(L[1:]-L[:-1],axis=2)
def lost_pairs(rgb, sim):
    oh, ov = pairs(rgb); sh, sv = pairs(sim(rgb))
    return (oh>=5)&(sh<.6*oh), (ov>=5)&(sv<.6*ov), oh, ov

def correct(rgb, t, w, shift):
    lin = srgb_to_linear(rgb); err = lin - lin @ cvd_matrix(t,1.0).T
    w = w[...,None] if np.ndim(w) else w
    return np.clip(linear_to_srgb(lin + w * (err @ shift.T)), 0, 1)

def mask(rgb, t, sigma_frac, normalize):
    lh, lv, _, _ = lost_pairs(rgb, lambda x: machado(x, t))   # 서버는 Machado로 판단
    m = np.zeros(rgb.shape[:2], np.float32)
    m[:,1:]+=lh; m[:,:-1]+=lh; m[1:]+=lv; m[:-1]+=lv
    m = cv2.GaussianBlur(np.minimum(m,1), (0,0), max(rgb.shape[:2])*sigma_frac)
    if normalize:  # 1차 안: 그림마다 최댓값 근처로 맞춤 → 드문 쌍도 강하게
        return np.clip(m / max(np.percentile(m[m>0],90) if (m>0).any() else 1, 1e-6), 0, 1)
    return np.clip(m * 3, 0, 1)  # 2차 안: 밀도 그대로 → 드문 쌍은 약하게, 좁게

def score(rgb, out, t):
    lh, lv, oh, ov = lost_pairs(rgb, lambda x: indep(x, t))   # 평가는 독립 모델
    ch, cv = pairs(indep(out, t))
    if lh.sum()+lv.sum() == 0: rec = rec_raw = float('nan')
    else:
        r = np.concatenate([ch[lh]/oh[lh], cv[lv]/ov[lv]])
        rec, rec_raw = np.minimum(r,1).mean(), r.mean()
    de = np.linalg.norm(lab(out)-lab(rgb), axis=2)
    lost = (lh.sum()+lv.sum())/(lh.size+lv.size)
    return lost, rec, rec_raw, de.mean(), float(np.percentile(de,90))

types = sys.argv[1].split(",")
for path in sys.argv[2:]:
    im = Image.open(path).convert("RGB"); im.thumbnail((600,600)); rgb = np.asarray(im,np.float32)/255
    for t in types:
        cur = ERROR_SHIFT[t]
        variants = [("보정 없음", rgb), ("현재 전체", correct(rgb,t,1.0,cur))]
        if t == "tritan": variants.append(("새행렬 전체", correct(rgb,t,1.0,NEW_T)))
        m1, m2 = mask(rgb,t,0.015,True), mask(rgb,t,0.006,False)
        variants += [("현재 헷갈리는곳(1차)", correct(rgb,t,m1,cur)), ("현재 헷갈리는곳(2차)", correct(rgb,t,m2,cur))]
        if t == "tritan":
            variants += [("새행렬 헷갈리는곳(1차)", correct(rgb,t,m1,NEW_T)), ("새행렬 헷갈리는곳(2차)", correct(rgb,t,m2,NEW_T))]
        lost = score(rgb, rgb, t)[0]
        print(f"\n[{path.split('/')[-1][:30]} · {t}] 독립모델 기준 헷갈리는 쌍 {lost:.1%}")
        print(f"  {'':24s}구분도(≤100%) 무제한   평균ΔE 상위10%ΔE")
        for label, out in variants:
            _, r, rr, de, p = score(rgb, out, t)
            print(f"  {label:24s}{r:9.0%} {rr:8.0%}  {de:7.1f} {p:7.1f}")
