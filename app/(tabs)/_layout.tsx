import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PixelIcon } from '~/components/pixel-icon';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(8, insets.bottom);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#9d91cc',
        tabBarInactiveTintColor: '#8fa4d8',
        tabBarStyle: {
          backgroundColor: '#09318d',
          borderTopColor: '#1f4ab2',
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 58 + bottomPadding,
          paddingBottom: bottomPadding,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontFamily: 'GeistMono-Medium',
          fontSize: 11,
          marginTop: 2,
        },
        tabBarHideOnKeyboard: true,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Capture',
          tabBarIcon: ({ color }) => <PixelIcon name="mic" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="notes"
        options={{
          title: 'Notes',
          tabBarIcon: ({ color }) => <PixelIcon name="notes" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="vault"
        options={{
          title: 'Vault',
          tabBarIcon: ({ color }) => <PixelIcon name="archive" size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}
