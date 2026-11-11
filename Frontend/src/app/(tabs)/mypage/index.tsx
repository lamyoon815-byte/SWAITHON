import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/common/big-button';
import { BottomSheet } from '@/components/common/bottom-sheet';
import { showToast } from '@/components/common/toast';
import { Avatar } from '@/components/mypage/avatar';
import { ButtonRadius, FontSize, MinTouchTarget, getPalette, type Palette } from '@/constants/a11y';
import { NARRATION_OPTIONS } from '@/constants/narration';
import { MaxContentWidth, ScreenPadding, Scrim, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useResource } from '@/hooks/use-resource';
import { useProfile } from '@/hooks/use-profile';
import { useCorrectionEntry } from '@/hooks/use-correction-entry';
import { useSettings } from '@/hooks/use-settings';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { getMuseums } from '@/lib/api';
import type { DeviceSettings } from '@/store/settings';
import type { NarrationMode } from '@/types/narration';

const FONT_OPTIONS = [
  { value: 'normal', label: '기본' },
  { value: 'large', label: '크게' },
  { value: 'xlarge', label: '아주 크게' },
] as const;

export default function MyPageScreen() {
  const { profile, loaded: profileLoaded, error: profileError, saveNarrationMode, reloadProfile } = useProfile();
  const correctionEntry = useCorrectionEntry();
  const palette = getPalette('dark', false);
  const bottomInset = useTabBarInset();
  const { settings, loaded, updateSettings } = useSettings();
  const { data: museums, error: museumError, reload: reloadMuseums } = useResource('museums', getMuseums);
  const [sheet, setSheet] = useState<'font' | 'narration' | 'museum' | 'photo' | null>(null);
  const { user, avatar, loaded: authLoaded, signOut, setAvatar, clearAvatar } = useAuth();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  // 닫히며 사라지는 동안에도 마지막 시트 내용을 유지한다.
  const [shown, setShown] = useState<NonNullable<typeof sheet>>('font');
  const openSheet = (kind: NonNullable<typeof sheet>) => { setShown(kind); setSheet(kind); };
  const [modeDraft, setModeDraft] = useState<NarrationMode>(profile.narration_mode);
  const narrationLabel = NARRATION_OPTIONS.find((option) => option.value === profile.narration_mode)?.label ?? '둘 다 듣기';
  const museum = museums?.find((m) => m.id === settings.recent_museum_id);
  const fontLabel = FONT_OPTIONS.find((option) => option.value === settings.font_scale)?.label ?? '기본';
  const card = { backgroundColor: palette.surface, borderColor: palette.outline };

  const selectFont = async (font_scale: DeviceSettings['font_scale']) => {
    await updateSettings({ font_scale });
    showToast('글씨 크기 설정을 저장했어요', 'success');
  };
  const clearMuseum = async () => {
    await updateSettings({ recent_museum_id: null });
    setSheet(null);
    showToast('미술관 기억을 지웠어요', 'success');
  };
  const openNarration = () => {
    setModeDraft(profile.narration_mode);
    openSheet('narration');
  };
  const saveNarration = async () => {
    if (savingMode) return;
    if (modeDraft === profile.narration_mode) { setSheet(null); return; }
    setSavingMode(true);
    try {
      await saveNarrationMode(modeDraft);
      setSheet(null);
      showToast('해설 방식을 저장했어요', 'success');
    } catch {
      showToast('해설 방식을 저장하지 못했어요. 다시 시도해 주세요', 'error');
    } finally {
      setSavingMode(false);
    }
  };

  const pickPhoto = async (source: 'library' | 'camera') => {
    try {
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast(source === 'camera' ? '카메라 권한을 허용하면 사진을 찍을 수 있어요' : '사진 접근을 허용하면 앨범에서 고를 수 있어요', 'error');
        return;
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], shape: 'oval', quality: 0.8 };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets[0]) return;
      await setAvatar(result.assets[0].uri);
      setSheet(null);
      showToast('프로필 사진을 바꿨어요', 'success');
    } catch {
      showToast('사진을 저장하지 못했어요. 다시 시도해 주세요', 'error');
    }
  };
  const resetPhoto = async () => {
    await clearAvatar();
    setSheet(null);
    showToast('기본 이미지로 바꿨어요', 'success');
  };
  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await signOut();
      setConfirmLogout(false);
      showToast('로그아웃했어요', 'success');
    } catch {
      showToast('로그아웃하지 못했어요. 다시 시도해 주세요', 'error');
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + Spacing.four }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>마이페이지</Text>
        <View style={[styles.card, card, styles.profileCard]}>
          {user ? (
            <View style={styles.profileRow}>
              <Pressable accessibilityRole="button" accessibilityLabel="프로필 사진 바꾸기" onPress={() => openSheet('photo')} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Avatar uri={avatar} name={user.nickname} palette={palette} />
                <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.cameraBadge, { backgroundColor: palette.text, borderColor: palette.surface }]}>
                  <SymbolView name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }} size={14} tintColor={palette.background} />
                </View>
              </Pressable>
              <View style={styles.profileTexts}>
                <Text numberOfLines={1} style={[styles.profileName, { color: palette.text }]}>{user.nickname}</Text>
                <Text numberOfLines={1} style={[styles.profileEmail, { color: palette.textSecondary }]}>{user.email}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.profileRow}>
              <Avatar uri={null} palette={palette} />
              <View style={styles.profileTexts}>
                <Text style={[styles.profileName, { color: palette.text }]}>{authLoaded ? '로그인해 주세요' : '불러오는 중'}</Text>
                <Text lineBreakStrategyIOS="hangul-word" style={[styles.profileEmail, { color: palette.textSecondary }]}>내 보기 설정과 관람 기록을 계정에 이어 둘 수 있어요</Text>
              </View>
            </View>
          )}
          {authLoaded && !user && (
            <View style={styles.buttonRow}><BigButton label="로그인 · 회원가입" palette={palette} onPress={() => router.push('/login')} /></View>
          )}
        </View>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, styles.settingsHeading, { color: palette.text }]}>내 화면 설정</Text>
          <View style={[styles.card, card]}>
            <SettingRow
              label="내 보정값"
              description={correctionEntry.description}
              palette={palette}
              onPress={correctionEntry.onPress}
            />
          </View>
          <View style={[styles.card, card]}>
            <SettingRow label="글씨 크기" value={loaded ? fontLabel : '불러오는 중'} icon={{ ios: 'textformat.size', android: 'format_size' }} palette={palette} onPress={() => openSheet('font')} disabled={!loaded} />
            <View style={[styles.divider, { backgroundColor: palette.outline }]} />
            <SettingRow label="해설 방식" value={profileLoaded ? narrationLabel : '불러오는 중'} icon={{ ios: 'headphones', android: 'headphones' }} palette={palette} onPress={openNarration} disabled={!profileLoaded} />
          </View>
          <View style={[styles.card, card]}>
            <SettingRow label="관람 기록" icon={{ ios: 'clock.arrow.circlepath', android: 'history' }} palette={palette} onPress={() => router.push('/history')} />
          </View>
          <View style={[styles.card, card]}>
            <SettingRow label="방문한 미술관" icon={{ ios: 'building.columns', android: 'account_balance' }} palette={palette} onPress={() => openSheet('museum')} />
          </View>
        </View>
        {user && (
          <>
            <View style={[styles.sectionDivider, { backgroundColor: palette.outline }]} />
            <Pressable accessibilityRole="button" accessibilityLabel="로그아웃" onPress={() => setConfirmLogout(true)}
              style={({ pressed }) => [styles.logout, pressed && { backgroundColor: palette.fill }]}>
              <SymbolView name={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }} size={22} tintColor={palette.textSecondary} />
              <Text style={[styles.logoutText, { color: palette.textSecondary }]}>로그아웃</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
      <BottomSheet visible={sheet !== null} title={shown === 'font' ? '글씨 크기' : shown === 'narration' ? '해설 방식' : shown === 'photo' ? '프로필 사진' : '방문한 미술관'} palette={palette} dismissible={!savingMode} onClose={() => setSheet(null)}>
                {shown === 'photo' ? (
                  <>
                    <View style={styles.photoPreview}><Avatar uri={avatar} name={user?.nickname} size={112} palette={palette} /></View>
                    <View style={styles.buttonRow}><BigButton label="앨범에서 고르기" palette={palette} onPress={() => { void pickPhoto('library'); }} /></View>
                    <View style={styles.buttonRow}><BigButton label="사진 찍기" selected={false} palette={palette} onPress={() => { void pickPhoto('camera'); }} /></View>
                    {avatar && <View style={styles.buttonRow}><BigButton label="기본 이미지로" selected={false} palette={palette} onPress={() => { void resetPhoto(); }} /></View>}
                  </>
                ) : shown === 'font' ? FONT_OPTIONS.map((option) => (
                  <View style={styles.buttonRow} key={option.value}>
                    <BigButton label={option.label} radio selected={settings.font_scale === option.value} palette={palette} onPress={() => { void selectFont(option.value); }} />
                  </View>
                )) : shown === 'narration' ? (
                  <View style={styles.narrationOptions} accessibilityRole="radiogroup" accessibilityLabel="해설 방식 선택">
                    {profileError ? (
                      <>
                        <Text style={[styles.body, { color: palette.textSecondary }]}>저장된 설정을 불러오지 못했어요.</Text>
                        <View style={styles.buttonRow}><BigButton label="다시 불러오기" palette={palette} onPress={() => { void reloadProfile(); }} /></View>
                      </>
                    ) : NARRATION_OPTIONS.map((option) => {
                      const selected = modeDraft === option.value;
                      const color = selected ? palette.accentText : palette.text;
                      return (
                        <Pressable
                          key={option.value}
                          accessibilityRole="radio"
                          accessibilityLabel={`${option.label}, ${option.description}`}
                          accessibilityState={{ checked: selected, disabled: savingMode }}
                          disabled={savingMode}
                          onPress={() => setModeDraft(option.value)}
                          style={({ pressed }) => [styles.narrationOption, { backgroundColor: selected ? palette.accent : palette.surface, borderColor: selected ? palette.accent : palette.border, opacity: savingMode ? 0.4 : pressed ? 0.7 : 1 }]}>
                          <Text
                            lineBreakStrategyIOS="hangul-word"
                            textBreakStrategy="highQuality"
                            android_hyphenationFrequency="none"
                            style={[styles.optionTitle, { color }]}>{option.label}</Text>
                          <Text
                            lineBreakStrategyIOS="hangul-word"
                            textBreakStrategy="highQuality"
                            android_hyphenationFrequency="none"
                            style={[styles.optionDescription, { color: selected ? color : palette.textSecondary }]}>{option.description}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <>
                    <Text style={[styles.body, { color: palette.textSecondary }]}>현재는 마지막으로 선택한 미술관 하나만 기억해요. 실제 방문 이력은 저장하지 않아요.</Text>
                    <Text style={[styles.museumName, { color: palette.text }]}>
                      {museumError ? '미술관 정보를 불러오지 못했어요' : !loaded || (settings.recent_museum_id && !museums) ? '미술관을 불러오는 중이에요' : museum?.name ?? '저장된 미술관이 없어요'}
                    </Text>
                    {!!museumError && (
                      <View style={styles.buttonRow}>
                        <BigButton label="다시 불러오기" selected={false} palette={palette} onPress={reloadMuseums} />
                      </View>
                    )}
                    <View style={styles.buttonRow}>
                      <BigButton label="미술관 기억 지우기" selected={false} palette={palette} disabled={!loaded || !settings.recent_museum_id} onPress={() => { void clearMuseum(); }} />
                    </View>
                  </>
                )}
                {shown === 'narration' ? (
                  <View style={[styles.buttonRow, styles.saveRow]}><BigButton label={savingMode ? '저장 중…' : '저장하기'} palette={palette} disabled={savingMode || profileError} onPress={() => { void saveNarration(); }} /></View>
                ) : shown === 'font' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="글씨 크기 선택창 닫기"
                    accessibilityState={{ disabled: savingMode }}
                    disabled={savingMode}
                    onPress={() => setSheet(null)}
                    style={({ pressed }) => [styles.fontClose, { opacity: pressed ? 0.7 : 1 }]}>
                    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} weight="semibold" tintColor={palette.textSecondary} />
                    </View>
                    <Text style={[styles.closeLabel, { color: palette.textSecondary }]}>닫기</Text>
                  </Pressable>
                ) : (
                  <View style={styles.buttonRow}><BigButton label="닫기" palette={palette} onPress={() => setSheet(null)} /></View>
                )}
      </BottomSheet>
      <Modal visible={confirmLogout} transparent animationType="fade" onRequestClose={() => { if (!loggingOut) setConfirmLogout(false); }}>
        <View style={[styles.scrim, { backgroundColor: Scrim }]}>
          <View accessibilityViewIsModal style={[styles.dialog, card]}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.text }]}>로그아웃할까요?</Text>
            <Text lineBreakStrategyIOS="hangul-word" style={[styles.body, { color: palette.textSecondary }]}>이 기기에 저장한 보기 설정은 그대로 남아요.</Text>
            <View style={styles.dialogActions}>
              <View style={styles.buttonRow}><BigButton label={loggingOut ? '로그아웃 중…' : '로그아웃'} palette={palette} disabled={loggingOut} onPress={() => { void logout(); }} /></View>
              <View style={styles.buttonRow}><BigButton label="취소" selected={false} palette={palette} disabled={loggingOut} onPress={() => setConfirmLogout(false)} /></View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

type RowProps = {
  label: string;
  description?: string;
  value?: string;
  icon?: { ios: SFSymbol; android: AndroidSymbol };
  palette: Palette;
  onPress: () => void;
  disabled?: boolean;
};

function SettingRow({ label, description, value, icon, palette, onPress, disabled }: RowProps) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={[label, description, value].filter(Boolean).join(', ')} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.fill }]}>
      {icon && <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><SymbolView name={{ ...icon, web: icon.android }} size={26} tintColor={palette.text} /></View>}
      <View style={styles.rowText}>
        <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
        {description && <Text style={[styles.description, { color: palette.textSecondary }]}>{description}</Text>}
      </View>
      {value && <Text style={[styles.value, { color: palette.textSecondary }]}>{value}</Text>}
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={20} weight="semibold" tintColor={palette.text} /></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingTop: Spacing.four },
  title: { fontSize: FontSize.heading, fontWeight: 700, textAlign: 'center', marginBottom: Spacing.four },
  section: { gap: 12 },
  sectionTitle: { fontSize: FontSize.heading, fontWeight: 700, marginBottom: Spacing.two },
  settingsHeading: { paddingLeft: Spacing.two },
  card: { borderWidth: 1.5, borderRadius: 24, overflow: 'hidden' },
  row: { minHeight: MinTouchTarget, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  rowText: { flex: 1, gap: Spacing.two },
  label: { fontSize: FontSize.body, fontWeight: 700 },
  description: { fontSize: FontSize.label, lineHeight: 27 },
  value: { flexShrink: 1, fontSize: FontSize.label, textAlign: 'right' },
  divider: { height: 1, marginHorizontal: Spacing.three },
  saveRow: { marginTop: Spacing.two },
  buttonRow: { flexDirection: 'row' },
  profileCard: { padding: Spacing.three, gap: Spacing.three, marginBottom: Spacing.four },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  profileTexts: { flex: 1, gap: Spacing.one },
  profileName: { fontSize: FontSize.heading, fontWeight: 700 },
  profileEmail: { fontSize: FontSize.label, lineHeight: 26 },
  cameraBadge: { position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  photoPreview: { alignItems: 'center', paddingVertical: Spacing.two },
  sectionDivider: { height: 1, marginTop: Spacing.four, marginBottom: Spacing.two },
  logout: { minHeight: MinTouchTarget, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.two, borderRadius: 12 },
  logoutText: { fontSize: FontSize.body, fontWeight: 600 },
  scrim: { flex: 1, justifyContent: 'center', padding: ScreenPadding },
  dialog: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, borderWidth: 1.5, borderRadius: 24, gap: Spacing.three },
  dialogActions: { gap: 12 },
  fontClose: { marginTop: Spacing.two, minHeight: MinTouchTarget, flexDirection: 'row', gap: Spacing.two, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.two },
  closeLabel: { fontSize: FontSize.button, fontWeight: 700, textAlign: 'center' },
  narrationOptions: { gap: 12 },
  narrationOption: { minHeight: MinTouchTarget, borderRadius: ButtonRadius, borderWidth: 2, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, gap: Spacing.two },
  optionTitle: { fontSize: FontSize.button, fontWeight: 700, textAlign: 'left' },
  optionDescription: { fontSize: 16, lineHeight: 24, textAlign: 'left' },
  body: { fontSize: FontSize.body, lineHeight: 30 },
  museumName: { fontSize: FontSize.body, fontWeight: 700 },
});
