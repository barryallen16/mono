import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PixelIcon, PixelIconName } from '~/components/pixel-icon';
import { Brand, Button, Panel } from '~/components/ui';
import { markOnboardingSeen } from '~/utils/onboarding';

function SpecRow({ icon, title, detail }: { icon: PixelIconName; title: string; detail: string }) {
  return (
    <View className="flex-row items-start gap-3 border-b border-line py-3 last:border-b-0">
      <View className="mt-0.5">
        <PixelIcon name={icon} size={16} color="#9d91cc" />
      </View>
      <View className="flex-1">
        <Text className="font-mono-semibold text-sm text-ink">{title}</Text>
        <Text className="mt-0.5 font-mono text-xs leading-5 text-muted">{detail}</Text>
      </View>
    </View>
  );
}

export default function Onboarding() {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);

  const handleStart = async () => {
    setIsStarting(true);
    try {
      await markOnboardingSeen();
      router.replace('/(tabs)');
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ padding: 20, flexGrow: 1, justifyContent: 'center' }}>
        <View className="w-full max-w-md gap-6 self-center">
          <Brand subtitle="Your private, offline voice log. Record a thought, extract tasks, search everything locally." />

          <Panel className="py-1">
            <SpecRow
              icon="mic"
              title="Voice-first capture"
              detail="Tap once to record up to 2 minutes, or type directly when it is quiet."
            />
            <SpecRow
              icon="notes"
              title="Structured automatically"
              detail="Every note pulls out tags and checkable action items without extra formatting."
            />
            <SpecRow
              icon="lock"
              title="Stored on your device"
              detail="Notes stay in local SQLite. Export JSON or wipe everything anytime."
            />
          </Panel>

          <Button
            label="Start recording"
            icon="arrow-right"
            onPress={handleStart}
            loading={isStarting}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
