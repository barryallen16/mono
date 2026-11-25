import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PixelIcon } from '~/components/pixel-icon';
import { Panel, ScreenHeader, tabularNums } from '~/components/ui';
import { computeStreak, formatLocalDate, listNotes, MonoNote } from '~/utils/db';

function last14Days(): string[] {
  const days: string[] = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    days.push(formatLocalDate(d));
  }
  return days;
}

export default function StreakScreen() {
  const [notes, setNotes] = useState<MonoNote[]>([]);

  useFocusEffect(
    useCallback(() => {
      listNotes().then(setNotes);
    }, [])
  );

  const streak = computeStreak(notes);
  const openTasks = notes.reduce(
    (sum, note) => sum + note.actionItems.filter((item) => !item.done).length,
    0
  );
  const activeDates = new Set(notes.map((n) => n.localDate));
  const days = last14Days();

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScreenHeader
        title="Streak"
        subtitle="Daily capture cadence"
        right={
          <View className="flex-row items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5">
            <PixelIcon name="zap" size={16} color="#9d91cc" />
            <Text className="font-pixel text-base text-ink" style={tabularNums}>
              {streak}d
            </Text>
          </View>
        }
      />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View className="w-full max-w-2xl gap-4 self-center">
          <Panel className="gap-3">
            <Text className="font-pixel text-base text-ink">Last 14 days</Text>
            <View className="flex-row justify-between gap-1.5">
              {days.map((day) => {
                const filled = activeDates.has(day);
                return (
                  <View
                    key={day}
                    className={`h-6 flex-1 rounded-sm border ${
                      filled ? 'border-accent bg-accent' : 'border-line bg-bg'
                    }`}
                  />
                );
              })}
            </View>
            <View className="flex-row justify-between">
              <Text className="font-mono text-xs text-muted" style={tabularNums}>
                {days[0]}
              </Text>
              <Text className="font-mono text-xs text-muted" style={tabularNums}>
                {days[days.length - 1]}
              </Text>
            </View>
          </Panel>

          <View className="flex-row gap-3">
            <Panel className="flex-1 gap-1">
              <Text className="font-mono text-xs text-muted">Entries</Text>
              <Text className="font-pixel text-2xl text-ink" style={tabularNums}>
                {notes.length}
              </Text>
            </Panel>
            <Panel className="flex-1 gap-1">
              <Text className="font-mono text-xs text-muted">Open tasks</Text>
              <Text className="font-pixel text-2xl text-ink" style={tabularNums}>
                {openTasks}
              </Text>
            </Panel>
          </View>

          <Panel className="gap-3">
            <Text className="font-pixel text-base text-ink">Recent log</Text>
            {notes.length === 0 ? (
              <Text className="font-mono text-xs text-muted">
                Capture your first note to start tracking daily streaks.
              </Text>
            ) : (
              notes.slice(0, 7).map((note) => (
                <View
                  key={note.id}
                  className="flex-row items-start justify-between gap-3 border-t border-line pt-2.5">
                  <View className="flex-1">
                    <Text className="font-mono-medium text-xs text-ink" numberOfLines={1}>
                      {note.title}
                    </Text>
                    <Text className="mt-0.5 font-mono text-xs text-muted" numberOfLines={1}>
                      {note.tags.map((t) => `#${t}`).join(' ')}
                    </Text>
                  </View>
                  <Text className="font-mono text-xs text-muted" style={tabularNums}>
                    {note.localDate}
                  </Text>
                </View>
              ))
            )}
          </Panel>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
