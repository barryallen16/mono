import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PixelIcon, PixelIconName } from '~/components/pixel-icon';
import { Brand, Button, Panel } from '~/components/ui';
import { prepareCactusModels } from '~/utils/cactus';
import { markOnboardingSeen } from '~/utils/onboarding';

function SpecRow({
  icon,
  title,
  detail,
  isLast = false,
}: {
  icon: PixelIconName;
  title: string;
  detail: string;
  isLast?: boolean;
}) {
  return (
    <View className={`flex-row items-start gap-3 py-3 ${isLast ? '' : 'border-b border-line'}`}>
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
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)');
      }
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ padding: 20, flexGrow: 1, justifyContent: 'center' }}>
        <View className="w-full max-w-md gap-6 self-center">
          <Brand subtitle="Private offline voice notes. Record a thought and get a title, summary, and todo list on your phone." />

          <Panel className="py-1">
            <SpecRow
              icon="mic"
              title="Fast voice capture"
              detail="Record up to 2 minutes per note and play clips back anytime."
            />
            <SpecRow
              icon="notes"
              title="Automatic todos and tags"
              detail="Pulls out a title, summary, tags, and checkable tasks locally."
            />
            <SpecRow
              icon="lock"
              title="Private on your device"
              detail="Audio, transcripts, and models stay on your phone. Export or wipe anytime."
              isLast
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
