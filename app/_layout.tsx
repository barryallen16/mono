import '../global.css';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';

import { hasSeenOnboarding } from '~/utils/onboarding';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const router = useRouter();
  const [fontsLoaded] = useFonts({
    'GeistPixel-Square': require('../assets/fonts/GeistPixel-Square.ttf'),
    'GeistMono-Regular': require('../assets/fonts/GeistMono-Regular.ttf'),
    'GeistMono-Medium': require('../assets/fonts/GeistMono-Medium.ttf'),
    'GeistMono-SemiBold': require('../assets/fonts/GeistMono-SemiBold.ttf'),
  });

  useEffect(() => {
    if (!fontsLoaded) return;
    (async () => {
      try {
        if (!(await hasSeenOnboarding())) {
          router.replace('/onboarding');
          return;
        }
        router.replace('/(tabs)');
      } catch {
        router.replace('/(tabs)');
      }
    })();
  }, [fontsLoaded, router]);

  if (!fontsLoaded) {
    return <View className="flex-1 bg-bg" />;
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#09318d' },
        }}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  );
}
