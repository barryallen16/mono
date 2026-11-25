import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NoteCard, NotePatch } from '~/components/note-card';
import { PixelIcon } from '~/components/pixel-icon';
import {
  Button,
  ErrorBanner,
  Field,
  Panel,
  ScreenHeader,
  Sheet,
  Tappable,
  tabularNums,
} from '~/components/ui';
import { stopActivePlayback } from '~/utils/audio';
import {
  deleteNote,
  MonoNote,
  processSavedNote,
  searchNotes,
  toggleActionItem,
  updateNote,
} from '~/utils/db';
import { ALLOWED_NOTE_TAGS } from '~/utils/notes';

const FILTERS = ['all', 'open', 'voice', ...ALLOWED_NOTE_TAGS] as const;
type NoteFilter = (typeof FILTERS)[number];

export default function NotesScreen() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<NoteFilter>('all');
  const [notes, setNotes] = useState<MonoNote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MonoNote | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const debouncedQueryRef = useRef(debouncedQuery);
  const activeFilterRef = useRef(activeFilter);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const hasFocusedRef = useRef(false);

  debouncedQueryRef.current = debouncedQuery;
  activeFilterRef.current = activeFilter;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async (searchText: string, filter: NoteFilter) => {
    const reqId = ++requestIdRef.current;
    try {
      const dbTag = filter === 'open' ? 'all' : filter;
      const items = await searchNotes(searchText, dbTag);
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
      hasFocusedRef.current = true;
      load(debouncedQueryRef.current, activeFilterRef.current);
      return () => {
        stopActivePlayback();
      };
    }, [load])
  );

  useEffect(() => {
    if (!hasFocusedRef.current) return;
    load(debouncedQuery, activeFilter);
  }, [debouncedQuery, activeFilter, load]);

  const visibleNotes = useMemo(() => {
    if (activeFilter === 'open') {
      return notes.filter((note) => note.actionItems.some((item) => !item.done));
    }
    if (activeFilter === 'all') return notes;
    return notes.filter((note) => note.tags.includes(activeFilter));
  }, [notes, activeFilter]);

  const handleToggleAction = async (noteId: number, actionId: string) => {
    try {
      const updated = await toggleActionItem(noteId, actionId);
      if (updated && mountedRef.current) {
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      }
    } catch {
      if (mountedRef.current) setError('Could not update task state.');
    }
  };

  const handleUpdate = async (noteId: number, patch: NotePatch) => {
    try {
      const updated = await updateNote(noteId, patch);
      if (updated && mountedRef.current) {
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Could not save note changes.');
      }
      throw err;
    }
  };

  const handleRetry = (noteId: number) => {
    setError(null);
    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId
          ? {
              ...n,
              audioState: n.audioUri ? 'pending' : n.audioState,
              lastError: null,
            }
          : n
      )
    );
    processSavedNote(noteId)
      .then((updated) => {
        if (!mountedRef.current || !updated) return;
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not reprocess note.');
        load(debouncedQueryRef.current, activeFilterRef.current);
      });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteNote(confirmDelete.id);
      if (!mountedRef.current) return;
      setNotes((prev) => prev.filter((n) => n.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch {
      if (mountedRef.current) setError('Could not delete note.');
    } finally {
      if (mountedRef.current) setIsDeleting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScreenHeader
        title="Notes"
        subtitle="Search and manage saved notes"
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
                const active = activeFilter === filter;
                const label = filter === 'all' || filter === 'open' ? filter : `#${filter}`;
                return (
                  <Tappable
                    key={filter}
                    onPress={() => setActiveFilter(filter)}
                    className={`min-h-10 items-center justify-center rounded-md border px-3 ${
                      active ? 'border-accent bg-accent' : 'border-line bg-panel'
                    }`}>
                    <Text
                      className={`font-mono-medium text-xs ${active ? 'text-bg' : 'text-muted'}`}>
                      {label}
                    </Text>
                  </Tappable>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </View>

      <FlatList
        data={visibleNotes}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          error ? (
            <View className="mb-3 w-full max-w-2xl self-center">
              <ErrorBanner>{error}</ErrorBanner>
            </View>
          ) : null
        }
        ItemSeparatorComponent={() => <View className="h-3" />}
        renderItem={({ item }) => (
          <View className="w-full max-w-2xl self-center">
            <NoteCard
              note={item}
              onToggleAction={handleToggleAction}
              onUpdate={handleUpdate}
              onDelete={setConfirmDelete}
              onRetry={handleRetry}
              onAudioError={setError}
            />
          </View>
        )}
        ListEmptyComponent={
          <View className="w-full max-w-2xl self-center">
            <Panel className="items-start gap-2">
              <PixelIcon name="search" size={24} color="#9d91cc" />
              <Text className="mt-1 font-pixel text-base text-ink">No matching notes</Text>
              <Text className="font-mono text-xs leading-5 text-muted">
                Try another keyword or switch back to all notes.
              </Text>
            </Panel>
          </View>
        }
      />

      <Sheet
        visible={confirmDelete !== null}
        onClose={() => !isDeleting && setConfirmDelete(null)}
        title="Delete entry?">
        <View className="gap-4">
          <Text className="font-mono text-xs leading-5 text-muted">
            This removes the entry and its saved audio clip from local storage.
          </Text>
          <View className="gap-2.5">
            <Button
              label="Delete"
              icon="trash"
              variant="danger"
              loading={isDeleting}
              onPress={handleConfirmDelete}
            />
            <Button
              label="Cancel"
              variant="secondary"
              disabled={isDeleting}
              onPress={() => setConfirmDelete(null)}
            />
          </View>
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
