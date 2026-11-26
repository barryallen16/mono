import '../global.css';
import { useFonts } from 'expo-font';
import { Stack, usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MonoLogo } from '~/components/pixel-icon';
import { hasSeenOnboarding, subscribeOnboardingChanged } from '~/utils/onboarding';

function BootSplash({ overlay = false }: { overlay?: boolean }) {
  return (
    <View
      style={overlay ? StyleSheet.absoluteFill : undefined}
      className="flex-1 items-center justify-center bg-bg">
      <MonoLogo height={66} color="#ffffff" />
    </View>
  );
}

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const navigationState = useRootNavigationState();
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
    const unsubscribe = subscribeOnboardingChanged((seen) => {
      if (active) setOnboardingSeen(seen);
    });
    hasSeenOnboarding()
      .then((seen) => {
        if (active) setOnboardingSeen(seen);
      })
      .catch(() => {
        if (active) setOnboardingSeen(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!fontsLoaded || onboardingSeen === null || !navigationState?.key) return;
    if (onboardingSeen || pathname === '/onboarding') {
      setBootOverlayDismissed(true);
      return;
    }
    if (!bootOverlayDismissed) {
      router.replace('/onboarding');
    }
  }, [fontsLoaded, onboardingSeen, navigationState?.key, pathname, bootOverlayDismissed, router]);

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
