import { View, StyleSheet } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { ToastHost } from '@/components/common/toast';

export default function TabLayout() {
  return (
    <View style={styles.root}>
      <AppTabs />
      <ToastHost />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
