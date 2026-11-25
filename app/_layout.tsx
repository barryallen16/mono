import '../global.css';
import { useFonts } from 'expo-font';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MonoLogo } from '~/components/pixel-icon';
import { hasSeenOnboarding } from '~/utils/onboarding';

function BootSplash({ overlay = false }: { overlay?: boolean }) {
  return (
    <View
      style={overlay ? StyleSheet.absoluteFill : undefined}
      className="flex-1 items-center justify-center bg-bg">
      <MonoLogo height={42} color="#ffffff" />
    </View>
  );
}

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);
  const [bootOverlayDismissed, setBootOverlayDismissed] = useState(false);

  const [fontsLoaded] = useFonts({
    'GeistPixel-Square': require('../assets/fonts/GeistPixel-Square.ttf'),
    'GeistMono-Regular': require('../assets/fonts/GeistMono-Regular.ttf'),
    'GeistMono-Medium': require('../assets/fonts/GeistMono-Medium.ttf'),
    'GeistMono-SemiBold': require('../assets/fonts/GeistMono-SemiBold.ttf'),
  });

  useEffect(() => {
    let active = true;
    hasSeenOnboarding()
      .then((seen) => {
        if (active) setOnboardingSeen(seen);
      })
      .catch(() => {
        if (active) setOnboardingSeen(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!fontsLoaded || onboardingSeen === null) return;
    if (onboardingSeen || pathname === '/onboarding') {
      setBootOverlayDismissed(true);
      return;
    }
    if (!bootOverlayDismissed) {
      router.replace('/onboarding');
    }
  }, [fontsLoaded, onboardingSeen, pathname, bootOverlayDismissed, router]);

  if (!fontsLoaded || onboardingSeen === null) {
    return <BootSplash />;
  }

  const showBootOverlay =
    !bootOverlayDismissed && onboardingSeen === false && pathname !== '/onboarding';

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
      {showBootOverlay ? <BootSplash overlay /> : null}
    </>
  );
}
