import { ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  PressableProps,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewProps,
} from 'react-native';

import { PixelIcon, PixelIconName } from './pixel-icon';

export const tabularNums = StyleSheet.create({
  text: { fontVariant: ['tabular-nums'] },
}).text;

type TappableProps = Omit<PressableProps, 'style' | 'children'> & {
  className?: string;
  children?: ReactNode;
};

export function Tappable({ className = '', disabled, children, ...rest }: TappableProps) {
  return (
    <Pressable
      className={className}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        transform: [{ scale: pressed && !disabled ? 0.97 : 1 }],
      })}
      {...rest}>
      {children}
    </Pressable>
  );
}

const buttonVariants = {
  primary: {
    container: 'bg-accent border border-accent',
    text: 'text-[#041236] font-pixel tracking-wider',
    icon: '#041236',
  },
  secondary: {
    container: 'border border-line bg-panel',
    text: 'text-ink font-mono-medium',
    icon: '#ffffff',
  },
  danger: {
    container: 'border border-danger/40 bg-danger/10',
    text: 'text-red-300 font-mono-medium',
    icon: '#fca5a5',
  },
  ghost: {
    container: 'border border-transparent',
    text: 'text-muted font-mono-medium',
    icon: '#d4cef0',
  },
} as const;

type ButtonProps = Omit<TappableProps, 'children'> & {
  label: string;
  icon?: PixelIconName;
  variant?: keyof typeof buttonVariants;
  loading?: boolean;
  textClassName?: string;
};

export function Button({
  label,
  icon,
  variant = 'primary',
  loading = false,
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
      className={`min-h-12 flex-row items-center justify-center gap-2.5 rounded-md px-4 ${
        styles.container
      } ${inactive ? 'opacity-40' : ''} ${className}`}
      {...rest}>
      {loading ? (
        <ActivityIndicator size="small" color={styles.icon} />
      ) : icon ? (
        <PixelIcon name={icon} size={16} color={styles.icon} />
      ) : null}
      <Text className={`text-sm ${styles.text} ${textClassName}`}>{label}</Text>
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

type FieldProps = TextInputProps & { className?: string };

export function Field({ className = '', multiline, onFocus, onBlur, ...rest }: FieldProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <TextInput
      className={`rounded-md border bg-bg px-3.5 font-mono text-sm text-ink ${
        multiline ? 'min-h-[112px] py-3' : 'min-h-12 py-3'
      } ${isFocused ? 'border-accent' : 'border-line'} ${className}`}
      placeholderTextColor="#8fa4d8"
      selectionColor="#9d91cc"
      multiline={multiline}
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
  );
}

export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View className="border-b border-line bg-bg px-4 pb-3 pt-3">
      <View className="w-full max-w-2xl flex-row items-center justify-between gap-4 self-center">
        <View className="flex-1">
          <Text className="font-pixel text-2xl tracking-wide text-ink">{title}</Text>
          {subtitle ? <Text className="mt-1 font-mono text-xs text-muted">{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </View>
  );
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <View className="flex-row items-start gap-2.5 rounded-md border border-danger/40 bg-danger/10 px-3.5 py-3">
      <PixelIcon name="info-box" size={16} color="#fca5a5" />
      <Text className="flex-1 font-mono text-xs leading-5 text-red-200">{children}</Text>
    </View>
  );
}

export function Brand({ subtitle = 'Speak once. Keep everything.' }: { subtitle?: string }) {
  return (
    <View className="items-start">
      <View className="h-12 w-12 items-center justify-center rounded-md border border-accent bg-accent/15">
        <PixelIcon name="mic" size={24} color="#9d91cc" />
      </View>
      <Text className="mt-4 font-pixel text-4xl tracking-wider text-ink">mono</Text>
      <Text className="mt-1.5 font-mono text-sm leading-5 text-muted">{subtitle}</Text>
    </View>
  );
}

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === 'web' ? 'none' : 'fade'}
      onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/80 p-5">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
        <View
          className="w-full max-w-md rounded-lg border border-line bg-panel p-5"
          style={{ maxHeight: '85%' }}
          accessibilityViewIsModal>
          <View className="flex-row items-center justify-between gap-3">
            <Text className="font-pixel text-xl tracking-wide text-ink">{title}</Text>
            <Tappable
              onPress={onClose}
              accessibilityLabel="Close"
              className="h-10 w-10 items-center justify-center rounded-md border border-line bg-bg">
              <PixelIcon name="close" size={16} color="#d4cef0" />
            </Tappable>
          </View>
          <ScrollView
            className="mt-4"
            style={{ flexShrink: 1 }}
            showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
