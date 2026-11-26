import { useRef, useState } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';

import { PixelIcon } from './pixel-icon';
import { Button, Field, Tappable, tabularNums } from './ui';

import { formatDuration } from '~/utils/notes';

export type RecordingMode = 'idle' | 'holding' | 'locked';

const LOCK_THRESHOLD_DY = -56;
const CANCEL_THRESHOLD_DX = -80;

export interface CaptureComposerProps {
  recordingMode: RecordingMode;
  elapsedSec: number;
  maxSec: number;
  meterLevel: number;
  draftText: string;
  onChangeDraftText: (text: string) => void;
  onSaveText: () => void;
  onHoldStart: () => void;
  onHoldLock: () => void;
  onHoldCancel: () => void;
  onHoldRelease: () => void;
  onLockedStop: () => void;
  onLockedCancel: () => void;
  isSaving: boolean;
  isBusy: boolean;
  hint: string | null;
}

export function CaptureComposer({
  recordingMode,
  elapsedSec,
  maxSec,
  meterLevel,
  draftText,
  onChangeDraftText,
  onSaveText,
  onHoldStart,
  onHoldLock,
  onHoldCancel,
  onHoldRelease,
  onLockedStop,
  onLockedCancel,
  isSaving,
  isBusy,
  hint,
}: CaptureComposerProps) {
  const [willCancel, setWillCancel] = useState(false);
  const [willLock, setWillLock] = useState(false);

  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const gestureOutcomeRef = useRef<'none' | 'locked' | 'cancelled'>('none');

  const hasDraftText = draftText.trim().length > 0;
  const micStartDisabled = (isBusy && recordingMode === 'idle') || isSaving;

  const stateRef = useRef({
    hasDraftText,
    micStartDisabled,
    onHoldStart,
    onHoldLock,
    onHoldCancel,
    onHoldRelease,
  });
  stateRef.current = {
    hasDraftText,
    micStartDisabled,
    onHoldStart,
    onHoldLock,
    onHoldCancel,
    onHoldRelease,
  };

  const resetGestureVisuals = () => {
    dragX.setValue(0);
    dragY.setValue(0);
    setWillCancel(false);
    setWillLock(false);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () =>
        !stateRef.current.micStartDisabled && !stateRef.current.hasDraftText,
      onMoveShouldSetPanResponder: () =>
        !stateRef.current.micStartDisabled && !stateRef.current.hasDraftText,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        gestureOutcomeRef.current = 'none';
        resetGestureVisuals();
        stateRef.current.onHoldStart();
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (gestureOutcomeRef.current !== 'none') return;
        const { dx, dy } = gestureState;

        if (dy < -10 && Math.abs(dy) >= Math.abs(dx)) {
          const clampedY = Math.max(-68, Math.min(0, dy));
          dragY.setValue(clampedY);
          dragX.setValue(0);
          const nearLock = dy <= LOCK_THRESHOLD_DY + 16;
          setWillLock(nearLock);
          setWillCancel(false);

          if (dy <= LOCK_THRESHOLD_DY) {
            gestureOutcomeRef.current = 'locked';
            resetGestureVisuals();
            stateRef.current.onHoldLock();
          }
          return;
        }

        if (dx < -10) {
          const clampedX = Math.max(-100, Math.min(0, dx));
          dragX.setValue(clampedX);
          dragY.setValue(0);
          const nearCancel = dx <= CANCEL_THRESHOLD_DX + 30;
          setWillCancel(nearCancel);
          setWillLock(false);

          if (dx <= CANCEL_THRESHOLD_DX) {
            gestureOutcomeRef.current = 'cancelled';
            resetGestureVisuals();
            stateRef.current.onHoldCancel();
          }
          return;
        }

        resetGestureVisuals();
      },
      onPanResponderRelease: () => {
        resetGestureVisuals();
        if (gestureOutcomeRef.current === 'none') {
          stateRef.current.onHoldRelease();
        }
        gestureOutcomeRef.current = 'none';
      },
      onPanResponderTerminate: () => {
        resetGestureVisuals();
        if (gestureOutcomeRef.current === 'none') {
          stateRef.current.onHoldCancel();
        }
        gestureOutcomeRef.current = 'none';
      },
    })
  ).current;

  if (recordingMode === 'locked') {
    return (
      <View className="border-t border-line bg-bg px-4 py-3">
        <View className="w-full max-w-2xl gap-3 self-center rounded-lg border border-accent bg-panel p-3.5">
          <View className="flex-row items-center justify-between gap-2">
            <View className="flex-row items-center gap-2">
              <View className="h-2.5 w-2.5 rounded-sm bg-danger" />
              <Text className="font-pixel text-sm text-ink">Recording locked</Text>
            </View>
            <Text className="font-mono text-xs text-muted" style={tabularNums}>
              {formatDuration(elapsedSec)} / {formatDuration(maxSec)}
            </Text>
          </View>

          <View className="h-2 overflow-hidden rounded-sm border border-line bg-bg">
            <View
              className="h-full bg-danger"
              style={{ width: `${Math.round(meterLevel * 100)}%` }}
            />
          </View>

          <View className="flex-row gap-2.5">
            <View className="flex-1">
              <Button
                label="Cancel"
                icon="close"
                variant="secondary"
                disabled={isBusy}
                onPress={onLockedCancel}
              />
            </View>
            <View className="flex-1">
              <Button
                label="Save clip"
                icon="check"
                variant="primary"
                disabled={isBusy}
                onPress={onLockedStop}
              />
            </View>
          </View>
        </View>
      </View>
    );
  }

  const showHoldStrip = recordingMode === 'holding';

  return (
    <View className="border-t border-line bg-bg px-4 py-3">
      <View className="w-full max-w-2xl gap-2 self-center">
        {showHoldStrip ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', right: 0, bottom: 72, zIndex: 10 }}
            className={`items-center gap-1 rounded-md border px-2.5 py-2 ${
              willLock ? 'border-accent bg-accent' : 'border-line bg-panel'
            }`}>
            <PixelIcon name="lock" size={16} color={willLock ? '#041236' : '#9d91cc'} />
            <Text
              className={`font-mono-medium text-[11px] ${
                willLock ? 'text-on-accent' : 'text-muted'
              }`}>
              {willLock ? 'Lock!' : 'Lock'}
            </Text>
          </View>
        ) : null}

        {hint ? (
          <Text className="font-mono text-xs text-accent">{hint}</Text>
        ) : showHoldStrip ? (
          <Text className="font-mono text-xs text-muted">
            Swipe up to lock - slide left to cancel
          </Text>
        ) : null}

        <View className="flex-row items-end gap-2.5">
          {showHoldStrip ? (
            <View className="min-h-12 flex-1 flex-row items-center gap-3 rounded-md border border-line bg-panel px-3.5 py-2.5">
              <View className="h-2.5 w-2.5 rounded-sm bg-danger" />
              <Text className="font-mono text-xs text-ink" style={tabularNums}>
                {formatDuration(elapsedSec)}
              </Text>
              <View className="h-2 flex-1 overflow-hidden rounded-sm border border-line bg-bg">
                <View
                  className="h-full bg-danger"
                  style={{ width: `${Math.round(meterLevel * 100)}%` }}
                />
              </View>
              <Text
                className={`font-mono text-xs ${willCancel ? 'text-danger-ink' : 'text-muted'}`}
                numberOfLines={1}>
                {willCancel ? 'Release!' : '< Cancel'}
              </Text>
            </View>
          ) : (
            <View className="flex-1">
              <Field
                placeholder="Type a note, or hold mic..."
                value={draftText}
                onChangeText={onChangeDraftText}
                multiline
                maxLength={5000}
                editable={!isSaving}
                style={{ minHeight: 48, maxHeight: 120 }}
              />
            </View>
          )}

          {hasDraftText && !showHoldStrip ? (
            <Tappable
              onPress={onSaveText}
              disabled={isSaving || isBusy}
              accessibilityLabel="Save text note"
              className={`h-12 flex-row items-center justify-center gap-1.5 rounded-md border border-accent bg-accent px-4 ${
                isSaving || isBusy ? 'opacity-40' : ''
              }`}>
              <PixelIcon name="check" size={16} color="#041236" />
              <Text className="font-pixel text-sm tracking-wider text-on-accent">
                {isSaving ? '...' : 'Save'}
              </Text>
            </Tappable>
          ) : (
            <Animated.View
              {...panResponder.panHandlers}
              accessible
              accessibilityRole="button"
              accessibilityLabel="Hold to record voice note. Swipe up to lock."
              accessibilityHint="Press and hold to record, swipe up to lock hands-free, or slide left to cancel."
              style={{
                transform: [
                  { translateX: dragX },
                  { translateY: dragY },
                  { scale: showHoldStrip ? 1.08 : 1 },
                ],
              }}
              className={`h-12 w-14 items-center justify-center rounded-md border ${
                showHoldStrip
                  ? willCancel
                    ? 'border-danger bg-danger/20'
                    : 'border-danger bg-danger'
                  : 'border-accent bg-accent'
              } ${micStartDisabled ? 'opacity-40' : ''}`}>
              <PixelIcon name="mic" size={24} color={showHoldStrip ? '#ffffff' : '#041236'} />
            </Animated.View>
          )}
        </View>
      </View>
    </View>
  );
}
