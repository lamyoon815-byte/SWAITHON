import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/common/text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/common/big-button';
import { BottomSheet } from '@/components/common/bottom-sheet';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { SegmentedControl } from '@/components/common/segmented-control';
import { TextButton } from '@/components/common/text-button';
import { showToast } from '@/components/common/toast';
import { PressableScale } from '@/components/common/pressable-scale';
import { Avatar } from '@/components/mypage/avatar';
import { ButtonRadius, FontSize, MinTouchTarget, getPalette, type Palette } from '@/constants/a11y';
import { NARRATION_OPTIONS } from '@/constants/narration';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useAvatar } from '@/hooks/use-avatar';
import { useProfile } from '@/hooks/use-profile';
import { useCorrectionEntry } from '@/hooks/use-correction-entry';
import { useSettings } from '@/hooks/use-settings';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { logout as apiLogout, updateNickname } from '@/lib/api';
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
  const [sheet, setSheet] = useState<'font' | 'narration' | 'photo' | null>(null);
  const { session } = useAuth();
  const user = session?.user ?? null;
  const { avatar, setAvatar, clearAvatar } = useAvatar(user?.id);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  // 닫히며 사라지는 동안에도 마지막 시트 내용을 유지한다.
  const [shown, setShown] = useState<NonNullable<typeof sheet>>('font');
  const openSheet = (kind: NonNullable<typeof sheet>) => { setShown(kind); setSheet(kind); };
  const [modeDraft, setModeDraft] = useState<NarrationMode>(profile.narration_mode);
  const narrationLabel = NARRATION_OPTIONS.find((option) => option.value === profile.narration_mode)?.label ?? '둘 다 듣기';
  const fontLabel = FONT_OPTIONS.find((option) => option.value === settings.font_scale)?.label ?? '기본';
  const card = { backgroundColor: palette.surface, borderColor: palette.outline };

  const selectFont = async (font_scale: DeviceSettings['font_scale']) => {
    await updateSettings({ font_scale });
    showToast('글씨 크기 설정을 저장했어요', 'success');
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

  const openProfile = () => {
    setNameDraft(user?.nickname ?? '');
    openSheet('photo');
  };
  const saveName = async () => {
    const nickname = nameDraft.trim();
    if (savingName || !nickname || nickname === user?.nickname) return;
    setSavingName(true);
    try {
      await updateNickname(nickname);
      showToast('이름을 바꿨어요', 'success');
    } catch {
      showToast('이름을 바꾸지 못했어요. 다시 시도해 주세요', 'error');
    } finally {
      setSavingName(false);
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
      await apiLogout();
      setConfirmLogout(false);
      showToast('로그아웃했어요', 'success');
    } catch {
      showToast('로그아웃하지 못했어요. 연결을 확인해 주세요', 'error');
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + Spacing.four }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>마이페이지</Text>
        {/* 프로필 카드 전체가 버튼: 누르면 이름과 사진을 바꾸는 시트가 열린다. */}
        <PressableScale accessibilityRole="button" accessibilityLabel={user ? `${user.nickname}, ${user.email}. 프로필 수정` : '프로필 불러오는 중'}
          accessibilityHint="이름과 프로필 사진을 바꿀 수 있어요" disabled={!user} onPress={openProfile}
          pressedScale={0.98} background={palette.surface} pressedBackground={palette.fill}
          style={[styles.card, { borderColor: palette.outline }, styles.profileCard]}>
          <View style={styles.profileRow}>
            <View>
              <Avatar uri={avatar} name={user?.nickname} palette={palette} />
              {user && <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.cameraBadge, { backgroundColor: palette.text, borderColor: palette.surface }]}>
                <SymbolView name={{ ios: 'pencil', android: 'edit', web: 'edit' }} size={14} tintColor={palette.background} />
              </View>}
            </View>
            <View style={styles.profileTexts}>
              <Text numberOfLines={1} style={[styles.profileName, { color: palette.text }]}>{user?.nickname ?? '불러오는 중'}</Text>
              {!!user && <Text numberOfLines={1} style={[styles.profileEmail, { color: palette.textSecondary }]}>{user.email}</Text>}
            </View>
            {!!user && <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={20} weight="semibold" tintColor={palette.text} />}
          </View>
        </PressableScale>
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
        </View>
        {user && (
          <>
            <View style={[styles.sectionDivider, { backgroundColor: palette.outline }]} />
            <PressableScale accessibilityRole="button" accessibilityLabel="로그아웃" onPress={() => setConfirmLogout(true)}
              pressedScale={0.98} background={`${palette.background}00`} pressedBackground={palette.fill} style={styles.logout}>
              <SymbolView name={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }} size={22} tintColor={palette.danger} />
              <Text style={[styles.logoutText, { color: palette.danger }]}>로그아웃</Text>
            </PressableScale>
          </>
        )}
        {/* 자주 쓰지 않아 설정 목록에서 빼고, 맨 아래 작은 글자 버튼으로만 둔다. */}
        <View style={styles.introLink}>
          <TextButton label="앱 소개 다시 보기" palette={palette} onPress={() => router.push('/onboarding')} />
        </View>
      </ScrollView>
      <BottomSheet visible={sheet !== null} title={shown === 'font' ? '글씨 크기' : shown === 'narration' ? '해설 방식' : '프로필 사진'} palette={palette} dismissible={!savingMode} onClose={() => setSheet(null)}>
                {shown === 'photo' ? (
                  <>
                    <View style={styles.photoPreview}><Avatar uri={avatar} name={nameDraft || user?.nickname} size={88} palette={palette} /></View>
                    <Text style={[styles.fieldLabel, { color: palette.text }]}>이름</Text>
                    <View style={[styles.nameField, { backgroundColor: palette.background, borderColor: palette.border }]}>
                      <TextInput value={nameDraft} onChangeText={setNameDraft} maxLength={40} placeholder="앱에서 부를 이름" placeholderTextColor={palette.textSecondary}
                        accessibilityLabel="이름" returnKeyType="done" onSubmitEditing={() => { void saveName(); }} style={[styles.nameInput, { color: palette.text }]} />
                    </View>
                    <View style={styles.buttonRow}>
                      <BigButton label={savingName ? '저장 중…' : '이름 저장'} palette={palette}
                        disabled={savingName || !nameDraft.trim() || nameDraft.trim() === user?.nickname} onPress={() => { void saveName(); }} />
                    </View>
                    <View style={[styles.sheetDivider, { backgroundColor: palette.outline }]} />
                    <Text style={[styles.fieldLabel, { color: palette.text }]}>프로필 사진</Text>
                    <SheetRow label="앨범에서 고르기" icon={{ ios: 'photo.on.rectangle', android: 'photo_library' }} palette={palette} onPress={() => { void pickPhoto('library'); }} />
                    <SheetRow label="사진 찍기" icon={{ ios: 'camera', android: 'photo_camera' }} palette={palette} onPress={() => { void pickPhoto('camera'); }} />
                    {avatar && <SheetRow label="기본 이미지로" icon={{ ios: 'person.crop.circle', android: 'account_circle' }} palette={palette} onPress={() => { void resetPhoto(); }} />}
                  </>
                ) : shown === 'font' ? (
                  <>
                    <SegmentedControl accessibilityLabel="글씨 크기" palette={palette} value={settings.font_scale}
                      onChange={(next) => { void selectFont(next); }} options={FONT_OPTIONS} />
                    <Text lineBreakStrategyIOS="hangul-word" style={[styles.description, { color: palette.textSecondary }]}>고르면 바로 앱 전체 글씨에 적용돼요.</Text>
                  </>
                ) : shown === 'narration' ? (
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
                ) : null}
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
                ) : shown === 'photo' ? (
                  <TextButton label="닫기" accessibilityLabel="프로필 수정 창 닫기" palette={palette} onPress={() => setSheet(null)} />
                ) : (
                  <View style={styles.buttonRow}><BigButton label="닫기" palette={palette} onPress={() => setSheet(null)} /></View>
                )}
      </BottomSheet>
      <ConfirmDialog
        visible={confirmLogout}
        title="로그아웃"
        message="정말 로그아웃할까요? 이 기기에 저장한 보기 설정은 그대로 남아요."
        confirmLabel={loggingOut ? '로그아웃 중…' : '로그아웃'}
        palette={palette}
        busy={loggingOut}
        onConfirm={() => { void logout(); }}
        onCancel={() => setConfirmLogout(false)}
      />
    </SafeAreaView>
  );
}

/** 시트 안의 가벼운 선택 행: 아이콘 + 글자. 테두리·배경 없이, 누를 때만 배경이 생긴다. */
function SheetRow({ label, icon, palette, onPress }: { label: string; icon: { ios: SFSymbol; android: AndroidSymbol }; palette: Palette; onPress: () => void }) {
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      pressedScale={0.98} background={`${palette.surface}00`} pressedBackground={palette.fill} style={styles.sheetRow}>
      <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.sheetRowIcon, { backgroundColor: palette.fill }]}>
        <SymbolView name={{ ...icon, web: icon.android }} size={22} tintColor={palette.text} />
      </View>
      <Text style={[styles.sheetRowLabel, { color: palette.text }]}>{label}</Text>
    </PressableScale>
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
    // 카드 안의 행이라 크기는 그대로 두고 회색만 스르륵 (카드 테두리는 움직이지 않는다).
    <PressableScale accessibilityRole="button" accessibilityLabel={[label, description, value].filter(Boolean).join(', ')} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      pressedScale={1} background={palette.surface} pressedBackground={palette.fill} style={styles.row}>
      {icon && <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><SymbolView name={{ ...icon, web: icon.android }} size={26} tintColor={palette.text} /></View>}
      <View style={styles.rowText}>
        <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
        {description && <Text style={[styles.description, { color: palette.textSecondary }]}>{description}</Text>}
      </View>
      {value && <Text style={[styles.value, { color: palette.textSecondary }]}>{value}</Text>}
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={20} weight="semibold" tintColor={palette.text} /></View>
    </PressableScale>
  );
}

/** 카드 안 내용이 시작하는 위치: 테두리 1.5 + 안쪽 여백 16 */
const CardInset = 1.5 + Spacing.three;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingTop: Spacing.four },
  // 제목·소제목·로그아웃은 카드 안 내용(테두리 1.5 + 여백 16)과 같은 선에서 시작한다. 카드 모서리가 둥근 만큼 안쪽으로.
  title: { fontSize: FontSize.heading, fontWeight: 700, paddingLeft: CardInset, marginBottom: Spacing.four },
  section: { gap: 12 },
  sectionTitle: { fontSize: FontSize.heading, fontWeight: 700, marginBottom: Spacing.two },
  settingsHeading: { paddingLeft: CardInset },
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
  fieldLabel: { fontSize: FontSize.label, fontWeight: 700, paddingLeft: Spacing.one },
  nameField: { minHeight: MinTouchTarget, borderWidth: 1.5, borderRadius: 16, paddingHorizontal: Spacing.three, justifyContent: 'center' },
  nameInput: { fontSize: FontSize.body, paddingVertical: 10 },
  sheetDivider: { height: 1, marginVertical: Spacing.two },
  sectionDivider: { height: 1, marginTop: Spacing.four, marginBottom: Spacing.two },
  logout: { minHeight: MinTouchTarget, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: CardInset, borderRadius: 16 },
  introLink: { alignItems: 'center', marginTop: Spacing.four },
  logoutText: { fontSize: FontSize.body, fontWeight: 600 },
  sheetRow: { minHeight: MinTouchTarget, flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: -Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: 14 },
  sheetRowIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sheetRowLabel: { flex: 1, fontSize: FontSize.body, fontWeight: 600 },
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
});
