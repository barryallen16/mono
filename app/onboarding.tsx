import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PixelIcon, PixelIconName } from '~/components/pixel-icon';
import { Brand, Button, Panel } from '~/components/ui';
import { prepareCactusModels } from '~/utils/cactus';
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
      prepareCactusModels().catch(() => {});
      router.replace('/(tabs)');
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ padding: 20, flexGrow: 1, justifyContent: 'center' }}>
        <View className="w-full max-w-md gap-6 self-center">
          <Brand subtitle="Private offline voice log. Whistle transcribes speech and Needle 3 extracts tasks on your phone." />

          <Panel className="py-1">
            <SpecRow
              icon="mic"
              title="Whistle speech-to-text"
              detail="Record up to 2 minutes and transcribe audio locally on CPU."
            />
            <SpecRow
              icon="notes"
              title="Needle 3 task extraction"
              detail="Pulls out a title, summary, tags, and checkable todos automatically."
            />
            <SpecRow
              icon="lock"
              title="Zero cloud calls"
              detail="Audio, transcripts, and weights stay on your device. Export or wipe anytime."
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
