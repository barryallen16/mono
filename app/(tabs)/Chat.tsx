import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NoteCard } from '~/components/note-card';
import { PixelIcon } from '~/components/pixel-icon';
import { ErrorBanner, Field, Panel, ScreenHeader, Tappable, tabularNums } from '~/components/ui';
import { stopActivePlayback } from '~/utils/audio';
import { listNotes, MonoNote, searchNotes, toggleActionItem } from '~/utils/db';

const FILTERS = ['all', 'voice', 'todo', 'idea', 'bug', 'ship'] as const;

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<(typeof FILTERS)[number]>('all');
  const [notes, setNotes] = useState<MonoNote[]>([]);
  const [error, setError] = useState<string | null>(null);

  const queryRef = useRef(query);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const hasMountedRef = useRef(false);

  queryRef.current = query;

  const load = useCallback(async (searchText: string) => {
    const reqId = ++requestIdRef.current;
    try {
      const items = searchText.trim() ? await searchNotes(searchText) : await listNotes();
      if (!mountedRef.current || requestIdRef.current !== reqId) return;
      setNotes(items);
      setError(null);
    } catch {
      if (!mountedRef.current || requestIdRef.current !== reqId) return;
      setError('Could not load local notes.');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(queryRef.current);
      return () => {
        stopActivePlayback();
      };
    }, [load])
  );

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    load(query);
  }, [query, load]);

  const visibleNotes =
    activeTag === 'all' ? notes : notes.filter((note) => note.tags.includes(activeTag));

  const handleToggle = async (noteId: number, actionId: string) => {
    await toggleActionItem(noteId, actionId);
    load(queryRef.current);
  };

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScreenHeader
        title="Search"
        subtitle="Filter local notes by word or tag"
        right={
          <Text className="font-mono text-xs text-muted" style={tabularNums}>
            {visibleNotes.length} {visibleNotes.length === 1 ? 'note' : 'notes'}
          </Text>
        }
      />

      <View className="border-b border-line bg-bg px-4 py-3">
        <View className="w-full max-w-2xl gap-3 self-center">
          <View className="flex-row items-center gap-2">
            <View className="flex-1">
              <Field
                placeholder="Search transcripts, titles, #tags..."
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
            </View>
            {query ? (
              <Tappable
                onPress={() => setQuery('')}
                accessibilityLabel="Clear search"
                className="h-12 w-12 items-center justify-center rounded-md border border-line bg-panel">
                <PixelIcon name="close" size={16} color="#d4cef0" />
              </Tappable>
            ) : null}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2">
              {FILTERS.map((filter) => {
                const active = activeTag === filter;
                return (
                  <Tappable
                    key={filter}
                    onPress={() => setActiveTag(filter)}
                    className={`min-h-10 items-center justify-center rounded-md border px-3 ${
                      active ? 'border-accent bg-accent' : 'border-line bg-panel'
                    }`}>
                    <Text
                      className={`font-mono-medium text-xs ${active ? 'text-bg' : 'text-muted'}`}>
                      {filter === 'all' ? 'all' : `#${filter}`}
                    </Text>
                  </Tappable>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        keyboardDismissMode="on-drag">
        <View className="w-full max-w-2xl gap-3 self-center">
          {error ? <ErrorBanner>{error}</ErrorBanner> : null}

          {visibleNotes.length === 0 ? (
            <Panel className="items-start gap-2">
              <PixelIcon name="search" size={24} color="#9d91cc" />
              <Text className="mt-1 font-pixel text-base text-ink">No matching notes</Text>
              <Text className="font-mono text-xs leading-5 text-muted">
                Try another keyword or switch back to all tags.
              </Text>
            </Panel>
          ) : (
            visibleNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onToggleAction={handleToggle}
                onAudioError={setError}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
