import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  PressableProps,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  useWindowDimensions,
  View,
  ViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MonoLogo, PixelIcon, PixelIconName } from './pixel-icon';

export const tabularNums = StyleSheet.create({
  text: { fontVariant: ['tabular-nums'] },
}).text;

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => {});

    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value) => {
      setReduced(value);
    });
    return () => {
      active = false;
      sub?.remove?.();
    };
  }, []);

  return reduced;
}

type TappableProps = Omit<PressableProps, 'style' | 'children'> & {
  className?: string;
  children?: ReactNode;
};

export function Tappable({
  className = '',
  disabled,
  children,
  hitSlop = 4,
  ...rest
}: TappableProps) {
  const reducedMotion = useReducedMotion();

  return (
    <Pressable
      className={className}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => ({
        opacity: pressed && !disabled ? 0.86 : 1,
        transform: [{ scale: pressed && !disabled && !reducedMotion ? 0.985 : 1 }],
      })}
      {...rest}>
      {children}
    </Pressable>
  );
}

const buttonVariants = {
  primary: {
    container: 'bg-accent border border-accent',
    text: 'text-on-accent font-pixel tracking-wider',
    icon: '#041236',
  },
  secondary: {
    container: 'border border-line bg-panel',
    text: 'text-ink font-mono-medium',
    icon: '#ffffff',
  },
  danger: {
    container: 'border border-danger-line bg-danger',
    text: 'text-ink font-mono-medium',
    icon: '#ffffff',
  },
  ghost: {
    container: 'border border-line-subtle bg-transparent',
    text: 'text-muted font-mono-medium',
    icon: '#d4cef0',
  },
} as const;

type ButtonProps = Omit<TappableProps, 'children'> & {
  label: string;
  icon?: PixelIconName;
  variant?: keyof typeof buttonVariants;
  loading?: boolean;
  loadingLabel?: string;
  textClassName?: string;
};

export function Button({
  label,
  icon,
  variant = 'primary',
  loading = false,
  loadingLabel,
  disabled,
  className = '',
  textClassName = '',
  ...rest
}: ButtonProps) {
  const styles = buttonVariants[variant];
  const inactive = disabled || loading;

  return (
    <Tappable
      disabled={inactive}
      accessibilityState={{ disabled: Boolean(inactive), busy: loading }}
      className={`min-h-12 flex-row items-center justify-center gap-2.5 rounded-md px-4 py-2.5 ${
        styles.container
      } ${inactive ? 'opacity-50' : ''} ${className}`}
      {...rest}>
      {loading ? (
        <ActivityIndicator size="small" color={styles.icon} />
      ) : icon ? (
        <PixelIcon name={icon} size={16} color={styles.icon} />
      ) : null}
      <Text className={`text-sm ${styles.text} ${textClassName}`}>
        {loading && loadingLabel ? loadingLabel : label}
      </Text>
    </Tappable>
  );
}

export function Panel({
  className = '',
  padded = true,
  ...rest
}: ViewProps & { padded?: boolean }) {
  return (
    <View
      className={`rounded-lg border border-line bg-panel ${padded ? 'p-4' : ''} ${className}`}
      {...rest}
    />
  );
}

type FieldProps = TextInputProps & {
  className?: string;
  label?: string;
  hint?: string;
  errorText?: string | null;
  onClear?: () => void;
  clearLabel?: string;
  leftIcon?: PixelIconName;
};

export function Field({
  className = '',
  label,
  hint,
  errorText,
  onClear,
  clearLabel = 'Clear input',
  leftIcon,
  multiline,
  value,
  onFocus,
  onBlur,
  accessibilityLabel,
  placeholder,
  ...rest
}: FieldProps) {
  const [isFocused, setIsFocused] = useState(false);
  const showClear = Boolean(onClear && typeof value === 'string' && value.length > 0);
  const borderClass = errorText
    ? 'border-danger-line'
    : isFocused
      ? 'border-accent'
      : 'border-line';

  return (
    <View className="gap-1.5">
      {label ? <Text className="font-mono-medium text-xs text-muted">{label}</Text> : null}
      <View
        className={`flex-row items-center rounded-md border bg-bg ${borderClass} ${
          isFocused ? 'bg-panel' : ''
        }`}>
        {leftIcon ? (
          <View className="pl-3">
            <PixelIcon name={leftIcon} size={16} color={isFocused ? '#ffffff' : '#d4cef0'} />
          </View>
        ) : null}
        <TextInput
          className={`flex-1 font-mono text-sm text-ink ${
            multiline ? 'min-h-[112px] py-3' : 'min-h-12 py-3'
          } ${leftIcon ? 'pl-2.5' : 'pl-3.5'} ${showClear ? 'pr-1' : 'pr-3.5'} ${className}`}
          placeholder={placeholder}
          placeholderTextColor="#b0bef0"
          selectionColor="#9d91cc"
          multiline={multiline}
          value={value}
          accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
          textAlignVertical={multiline ? 'top' : 'center'}
          onFocus={(event) => {
            setIsFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setIsFocused(false);
            onBlur?.(event);
          }}
          {...rest}
        />
        {showClear ? (
          <Tappable
            onPress={onClear}
            accessibilityLabel={clearLabel}
            className="h-12 w-12 items-center justify-center">
            <PixelIcon name="close" size={16} color="#d4cef0" />
          </Tappable>
        ) : null}
      </View>
      {errorText ? (
        <Text className="font-mono text-xs text-danger-ink">{errorText}</Text>
      ) : hint ? (
        <Text className="font-mono text-xs leading-5 text-muted">{hint}</Text>
      ) : null}
    </View>
  );
}

export function ScreenHeader({
  title,
  titleNode,
  subtitle,
  right,
}: {
  title?: string;
  titleNode?: ReactNode;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View className="border-b border-line bg-bg px-4 pb-3.5 pt-3">
      <View className="w-full max-w-2xl flex-row items-center justify-between gap-4 self-center">
        <View className="flex-1" accessibilityRole="header">
          {titleNode ?? <Text className="font-pixel text-2xl tracking-wide text-ink">{title}</Text>}
          {subtitle ? <Text className="mt-1 font-mono text-xs text-muted">{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </View>
  );
}

export function ErrorBanner({
  children,
  onRetry,
  retryLabel = 'Retry',
}: {
  children: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <View
      accessibilityRole="alert"
      className="flex-row items-center gap-3 rounded-md border border-danger-line bg-danger-surface px-3.5 py-3">
      <PixelIcon name="info-box" size={16} color="#fca5a5" />
      <Text className="flex-1 font-mono text-xs leading-5 text-danger-ink">{children}</Text>
      {onRetry ? (
        <Tappable
          onPress={onRetry}
          accessibilityLabel={retryLabel}
          className="min-h-10 flex-row items-center gap-1 rounded-sm border border-danger-line bg-bg px-3">
          <PixelIcon name="refresh" size={16} color="#fca5a5" />
          <Text className="font-mono-medium text-xs text-ink">{retryLabel}</Text>
        </Tappable>
      ) : null}
    </View>
  );
}

export function ToastBanner({
  message,
  tone = 'success',
  onDismiss,
}: {
  message: string;
  tone?: 'success' | 'info' | 'warning';
  onDismiss?: () => void;
}) {
  const toneConfig = {
    success: { icon: 'check' as PixelIconName, color: '#86efac', border: 'border-success/70' },
    info: { icon: 'info-box' as PixelIconName, color: '#d4cef0', border: 'border-line' },
    warning: { icon: 'clock' as PixelIconName, color: '#fde68a', border: 'border-warning/70' },
  }[tone];

  return (
    <View
      accessibilityLiveRegion="polite"
      className={`flex-row items-center gap-2.5 rounded-md border ${toneConfig.border} bg-panel px-3.5 py-2.5`}>
      <PixelIcon name={toneConfig.icon} size={16} color={toneConfig.color} />
      <Text className="flex-1 font-mono text-xs leading-5 text-ink">{message}</Text>
      {onDismiss ? (
        <Tappable
          onPress={onDismiss}
          accessibilityLabel="Dismiss notice"
          className="h-10 w-10 items-center justify-center rounded-sm">
          <PixelIcon name="close" size={16} color="#d4cef0" />
        </Tappable>
      ) : null}
    </View>
  );
}

export function SkeletonNoteCard() {
  const reducedMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(reducedMotion ? 0.65 : 0.45)).current;

  useEffect(() => {
    if (reducedMotion) {
      pulse.setValue(0.65);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.85,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reducedMotion]);

  return (
    <Panel className="gap-3" accessible accessibilityLabel="Loading note">
      <Animated.View style={{ opacity: pulse }} className="gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <View className="h-5 w-44 rounded-sm bg-elevated" />
          <View className="h-4 w-20 rounded-sm bg-elevated" />
        </View>
        <View className="gap-2">
          <View className="h-4 w-full rounded-sm bg-elevated" />
          <View className="h-4 w-3/4 rounded-sm bg-elevated" />
        </View>
        <View className="h-11 w-full rounded-md border border-line-subtle bg-bg" />
      </Animated.View>
    </Panel>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionIcon,
  actionVariant = 'primary',
  onAction,
  secondaryLabel,
  onSecondaryAction,
}: {
  icon: PixelIconName;
  title: string;
  description: string;
  actionLabel?: string;
  actionIcon?: PixelIconName;
  actionVariant?: keyof typeof buttonVariants;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
}) {
  return (
    <Panel className="items-start gap-3">
      <View className="h-12 w-12 items-center justify-center rounded-md border border-line bg-bg">
        <PixelIcon name={icon} size={24} color="#d4cef0" />
      </View>
      <View className="gap-1">
        <Text className="font-pixel text-lg text-ink">{title}</Text>
        <Text className="font-mono text-sm leading-6 text-muted">{description}</Text>
      </View>
      {actionLabel && onAction ? (
        <View className="w-full gap-2 pt-1">
          <Button
            label={actionLabel}
            icon={actionIcon}
            variant={actionVariant}
            onPress={onAction}
          />
          {secondaryLabel && onSecondaryAction ? (
            <Button label={secondaryLabel} variant="ghost" onPress={onSecondaryAction} />
          ) : null}
        </View>
      ) : null}
    </Panel>
  );
}

export function Brand({ subtitle = 'Speak once. Keep everything.' }: { subtitle?: string }) {
  return (
    <View className="items-start">
      <View className="h-12 w-12 items-center justify-center rounded-md border border-accent bg-panel">
        <PixelIcon name="mic" size={24} color="#d4cef0" />
      </View>
      <View className="mt-4" accessibilityRole="header" accessibilityLabel="mono">
        <MonoLogo height={34} color="#ffffff" />
      </View>
      <Text className="mt-2 font-mono text-sm leading-6 text-muted">{subtitle}</Text>
    </View>
  );
}

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 600;
  const reducedMotion = useReducedMotion();
  const dragY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) dragY.setValue(0);
  }, [dragY, visible]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_evt, gs) => gs.dy > 6,
        onPanResponderMove: (_evt, gs) => {
          if (gs.dy > 0) dragY.setValue(gs.dy);
        },
        onPanResponderRelease: (_evt, gs) => {
          if (gs.dy > 72 || gs.vy > 0.8) {
            onClose();
            return;
          }
          Animated.timing(dragY, {
            toValue: 0,
            duration: reducedMotion ? 0 : 180,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start();
        },
      }),
    [dragY, onClose, reducedMotion]
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className={`flex-1 bg-[#020a24]/80 ${
          isWide ? 'items-center justify-center p-6' : 'justify-end'
        }`}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessible
          accessibilityLabel="Close dialog"
          accessibilityRole="button"
        />
        <Animated.View
          style={{
            maxHeight: '88%',
            paddingBottom: isWide ? 20 : Math.max(20, insets.bottom + 8),
            transform: [{ translateY: dragY }],
          }}
          className={`w-full border border-line bg-panel px-5 pt-3 ${
            isWide ? 'max-w-lg rounded-lg' : 'rounded-t-2xl border-b-0'
          }`}
          accessibilityViewIsModal>
          <View {...panResponder.panHandlers} className="items-center pb-2">
            <View className="mb-3 h-1 w-10 rounded-full bg-line" />
            <View className="w-full flex-row items-center justify-between gap-3">
              <View className="flex-1">
                <Text className="font-pixel text-xl tracking-wide text-ink">{title}</Text>
                {subtitle ? (
                  <Text className="mt-0.5 font-mono text-xs text-muted">{subtitle}</Text>
                ) : null}
              </View>
              <Tappable
                onPress={onClose}
                accessibilityLabel="Close"
                className="h-12 w-12 items-center justify-center rounded-md border border-line bg-bg">
                <PixelIcon name="close" size={16} color="#d4cef0" />
              </Tappable>
            </View>
          </View>
          <ScrollView
            className="mt-3"
            style={{ flexShrink: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
