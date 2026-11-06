import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Brand, C } from '../../components/Brand';
import { Icon } from '../../components/UI';
import { api } from '../../services/api';
import GoogleButton from './GoogleButton';
import type { AuthOptions, AuthResult } from './types';
type Screen = 'signup' | 'signin' | 'verify' | 'forgot' | 'reset';
function Input({
  label,
  value,
  onChange,
  secure = false,
  icon,
  keyboard = 'default',
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
  icon: React.ComponentProps<typeof Icon>['name'];
  keyboard?: 'default' | 'email-address' | 'number-pad';
  autoComplete?: React.ComponentProps<typeof TextInput>['autoComplete'];
}) {
  const [visible, setVisible] = useState(false),
    [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Text style={a.label}>{label}</Text>
      <View style={[a.inputWrap, focused && { borderColor: C.coral, backgroundColor: '#FFFDFC' }]}>
        <Icon name={icon} size={18} color={focused ? C.coral : '#8B98A5'} />
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          secureTextEntry={secure && !visible}
          autoComplete={autoComplete}
          autoCapitalize={secure || keyboard === 'email-address' ? 'none' : 'words'}
          keyboardType={keyboard}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={
            label === 'Full name'
              ? 'Your first and last name'
              : label === 'Email address'
                ? 'you@example.com'
                : secure
                  ? 'At least 12 characters'
                  : ''
          }
          placeholderTextColor="#A3ADB6"
          style={a.input}
        />
        {secure && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            hitSlop={10}
            onPress={() => setVisible(!visible)}
          >
            <Icon name={visible ? 'eye-off-outline' : 'eye-outline'} color={C.muted} size={19} />
          </Pressable>
        )}
      </View>
    </View>
  );
}
function TravelArt() {
  return (
    <Svg width="100%" height={220} viewBox="0 0 400 220">
      <Path
        d="M20 168 H96 Q120 168 120 144 V90 Q120 68 145 68 H280 Q304 68 304 42 V22"
        stroke="#395168"
        strokeWidth="3"
        strokeDasharray="6 9"
        fill="none"
      />
      <Circle cx="20" cy="168" r="7" fill={C.coral} />
      <Circle cx="304" cy="22" r="7" fill={C.mint} />
      <Rect x="134" y="97" width="192" height="104" rx="22" fill="#203951" />
      <Rect x="153" y="113" width="152" height="53" rx="9" fill="#DDF1E8" />
      <Path d="M228 114 V164 M155 173 H304" stroke="#11243A" strokeWidth="5" />
      <Circle cx="173" cy="196" r="14" fill="#0B1929" />
      <Circle cx="284" cy="196" r="14" fill="#0B1929" />
      <Circle cx="173" cy="196" r="5" fill="#EAF0F5" />
      <Circle cx="284" cy="196" r="5" fill="#EAF0F5" />
      <Rect x="151" y="176" width="18" height="6" rx="3" fill={C.coral} />
      <Rect x="291" y="176" width="15" height="6" rx="3" fill={C.mint} />
      <Circle cx="355" cy="75" r="27" fill="#DDF1E8" />
      <Path
        d="M344 75 L351 82 L366 67"
        fill="none"
        stroke={C.green}
        strokeWidth="4"
        strokeLinecap="round"
      />
    </Svg>
  );
}
export default function AuthScreen({
  onAuthenticated,
  initialError = '',
  onRetry,
}: {
  onAuthenticated: (token: string) => Promise<void>;
  initialError?: string;
  onRetry?: () => Promise<void>;
}) {
  const wide = useWindowDimensions().width > 960;
  const [screen, setScreen] = useState<Screen>('signup'),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [code, setCode] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [options, setOptions] = useState<AuthOptions | null>(null),
    [resendAt, setResendAt] = useState(0),
    [now, setNow] = useState(() => Date.now());
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    api<AuthOptions>('/auth/options')
      .then((value) => {
        if (active) setOptions(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function navigate(value: Screen) {
    setScreen(value);
    setError('');
    setNotice('');
    setCode('');
    setPassword('');
    setConfirm('');
  }
  async function finish(result: AuthResult) {
    if (result.token) {
      await onAuthenticated(result.token);
      return;
    }
    if (result.requiresVerification) {
      if (result.email) setEmail(result.email);
      setScreen('verify');
      setCode('');
      setPassword('');
      setConfirm('');
      setResendAt(Date.now() + 60000);
      return;
    }
    throw Error('We could not complete sign-in. Please try again.');
  }
  async function submit() {
    await run(async () => {
      if (screen === 'signup') {
        if (!name.trim()) throw Error('Please enter your full name.');
        if (password !== confirm) throw Error('Your passwords do not match.');
        await finish(await api<AuthResult>('/auth/register', { name, email, password }));
      } else if (screen === 'signin')
        await finish(await api<AuthResult>('/auth/login', { email, password }));
      else if (screen === 'verify')
        await finish(await api<AuthResult>('/auth/verify', { email, code }));
      else if (screen === 'forgot') {
        await api('/auth/forgot', { email });
        setScreen('reset');
        setCode('');
        setPassword('');
        setConfirm('');
        setResendAt(Date.now() + 60000);
        setNotice('If an email/password account exists, a reset code has been sent.');
      } else {
        if (password !== confirm) throw Error('Your passwords do not match.');
        await api('/auth/reset', { email, code, password });
        navigate('signin');
        setNotice('Password updated. Sign in with your new password.');
      }
    });
  }
  const heading =
    screen === 'signup'
      ? 'Your journey starts here.'
      : screen === 'signin'
        ? 'Good to see you again.'
        : screen === 'verify'
          ? 'Check your inbox.'
          : screen === 'forgot'
            ? 'Let’s get you back in.'
            : 'A fresh start.';
  const description =
    screen === 'signup'
      ? 'Create your account. Your next stop is closer than you think.'
      : screen === 'signin'
        ? 'Sign in and pick up where you left off.'
        : screen === 'verify'
          ? `We sent a six-digit verification code to ${email}.`
          : screen === 'forgot'
            ? 'Enter your email and we’ll help you reset your password.'
            : 'Enter your reset code and choose a new password.';
  const cooldown = Math.max(0, Math.ceil((resendAt - now) / 1000));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F4F0' }}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[a.page, { padding: wide ? 36 : 22 }]}
        >
          <View style={a.header}>
            <Brand />
            <View style={a.trust}>
              <View style={a.greenDot} />
              <Text style={a.trustText}>Made for your community</Text>
            </View>
          </View>
          <View style={[a.grid, wide && { flexDirection: 'row', alignItems: 'stretch' }]}>
            {wide && (
              <View style={a.story}>
                <View style={a.storyTag}>
                  <Text
                    style={{ color: C.mint, fontSize: 10, letterSpacing: 2, fontWeight: '700' }}
                  >
                    LESS WAITING. MORE LIVING.
                  </Text>
                </View>
                <Text style={a.storyTitle}>
                  Go together.{'\n'}
                  <Text style={{ color: '#FFA28E' }}>Worry less.</Text>
                </Text>
                <Text style={a.storyBody}>
                  The ride to class. The journey home. A little peace of mind along the way.
                </Text>
                <TravelArt />
                <View style={a.storyDivider} />
                {[
                  [
                    'navigate-outline',
                    'Know where your ride is.',
                    'Follow your shuttle’s shared location.',
                  ],
                  [
                    'hand-left-outline',
                    'Make your stop count.',
                    'Request pickup at your approved stop.',
                  ],
                  [
                    'heart-outline',
                    'Keep your people close.',
                    'Choose who can follow your journey.',
                  ],
                ].map(([icon, title, body]) => (
                  <View key={title} style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                    <View style={a.storyIcon}>
                      <Icon
                        name={icon as React.ComponentProps<typeof Icon>['name']}
                        color={C.mint}
                        size={21}
                      />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={{ color: 'white', fontSize: 14, fontWeight: '600' }}>
                        {title}
                      </Text>
                      <Text style={{ color: '#A7B8C8', fontSize: 12, lineHeight: 18 }}>{body}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
            <View style={a.formOuter}>
              <View style={a.form}>
                <View style={a.stepRow}>
                  {['Create account', 'Verify email', 'Join community'].map((value, i) => (
                    <View
                      key={value}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    >
                      <View
                        style={[
                          a.stepDot,
                          {
                            backgroundColor:
                              i === (screen === 'verify' ? 1 : 0) ? C.coral : '#E9EDF0',
                          },
                        ]}
                      >
                        <Text
                          style={{
                            fontSize: 9,
                            fontWeight: '700',
                            color: i === (screen === 'verify' ? 1 : 0) ? 'white' : C.muted,
                          }}
                        >
                          {i + 1}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 9, color: C.muted }}>{value}</Text>
                      {i < 2 && (
                        <View
                          style={{
                            width: wide ? 18 : 8,
                            height: 1,
                            backgroundColor: C.line,
                            marginLeft: 3,
                          }}
                        />
                      )}
                    </View>
                  ))}
                </View>
                {screen !== 'signup' && screen !== 'signin' && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => navigate('signin')}
                    style={{
                      flexDirection: 'row',
                      gap: 7,
                      alignItems: 'center',
                      alignSelf: 'flex-start',
                    }}
                  >
                    <Icon name="arrow-back" size={16} color={C.muted} />
                    <Text style={{ fontSize: 12, color: C.muted }}>Back to sign in</Text>
                  </Pressable>
                )}
                <View style={{ gap: 10 }}>
                  <Text style={a.formEyebrow}>NEXT STOP • YOUR RIDE. IN SIGHT.</Text>
                  <Text style={[a.heading, { fontSize: wide ? 33 : 29 }]}>{heading}</Text>
                  <Text style={a.description}>{description}</Text>
                </View>
                {initialError && (
                  <View style={a.error}>
                    <Text style={a.errorText}>{initialError}</Text>
                    {onRetry && (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          void run(async () => {
                            await onRetry();
                            setOptions(await api<AuthOptions>('/auth/options'));
                          })
                        }
                      >
                        <Text
                          style={{ color: C.coral, fontSize: 12, fontWeight: '700', marginTop: 9 }}
                        >
                          Try again
                        </Text>
                      </Pressable>
                    )}
                  </View>
                )}
                {(screen === 'signup' || screen === 'signin') && (
                  <>
                    <GoogleButton
                      clientId={
                        options?.googleWebClientId ||
                        process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
                        ''
                      }
                      disabled={busy || !options?.googleEnabled}
                      onCredential={async (idToken, challenge) => {
                        await run(
                          async () =>
                            await finish(
                              await api<AuthResult>('/auth/google', {
                                idToken,
                                platform: Platform.OS === 'web' ? 'web' : 'native',
                                challenge,
                              }),
                            ),
                        );
                      }}
                      onError={setError}
                    />
                    {!options?.googleEnabled && (
                      <Text style={{ fontSize: 10, color: C.muted, textAlign: 'center' }}>
                        Google sign-in is temporarily unavailable. You can continue with email.
                      </Text>
                    )}
                    <View style={a.orRow}>
                      <View style={a.orLine} />
                      <Text style={{ fontSize: 11, color: '#98A2AC' }}>
                        or {screen === 'signup' ? 'sign up' : 'sign in'} with email
                      </Text>
                      <View style={a.orLine} />
                    </View>
                  </>
                )}
                {screen === 'signup' && (
                  <Input
                    label="Full name"
                    icon="person-outline"
                    value={name}
                    onChange={setName}
                    autoComplete="name"
                  />
                )}
                {(screen === 'signup' || screen === 'signin' || screen === 'forgot') && (
                  <Input
                    label="Email address"
                    icon="mail-outline"
                    value={email}
                    onChange={setEmail}
                    keyboard="email-address"
                    autoComplete="email"
                  />
                )}
                {(screen === 'verify' || screen === 'reset') && (
                  <View style={{ gap: 10 }}>
                    <Text style={a.label}>Verification code</Text>
                    <TextInput
                      accessibilityLabel="Verification code"
                      value={code}
                      onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                      keyboardType="number-pad"
                      autoComplete="one-time-code"
                      textContentType="oneTimeCode"
                      maxLength={6}
                      style={a.otp}
                    />
                    <Text style={{ fontSize: 11, color: C.muted }}>
                      Codes expire after 10 minutes. Check your spam folder too.
                    </Text>
                  </View>
                )}
                {(screen === 'signup' || screen === 'signin' || screen === 'reset') && (
                  <Input
                    label={screen === 'reset' ? 'New password' : 'Password'}
                    icon="lock-closed-outline"
                    value={password}
                    onChange={setPassword}
                    secure
                    autoComplete={screen === 'signin' ? 'current-password' : 'new-password'}
                  />
                )}
                {(screen === 'signup' || screen === 'reset') && (
                  <Input
                    label="Confirm password"
                    icon="shield-checkmark-outline"
                    value={confirm}
                    onChange={setConfirm}
                    secure
                    autoComplete="new-password"
                  />
                )}
                {screen === 'signin' && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => navigate('forgot')}
                    style={{ alignSelf: 'flex-end' }}
                  >
                    <Text style={{ color: C.coral, fontSize: 12, fontWeight: '600' }}>
                      Forgot password?
                    </Text>
                  </Pressable>
                )}
                {error && (
                  <View accessibilityRole="alert" style={a.error}>
                    <Text style={a.errorText}>{error}</Text>
                  </View>
                )}
                {notice && (
                  <View style={[a.error, { backgroundColor: C.mint }]}>
                    <Text style={[a.errorText, { color: C.green }]}>{notice}</Text>
                  </View>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    screen === 'signup'
                      ? 'Create account'
                      : screen === 'signin'
                        ? 'Sign in'
                        : screen === 'verify'
                          ? 'Verify email'
                          : screen === 'forgot'
                            ? 'Send reset code'
                            : 'Reset password'
                  }
                  disabled={busy}
                  onPress={() => void submit()}
                  style={({ pressed }) => [a.primary, { opacity: busy ? 0.6 : pressed ? 0.85 : 1 }]}
                >
                  {busy ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Text style={a.primaryText}>
                        {screen === 'signup'
                          ? 'Create account'
                          : screen === 'signin'
                            ? 'Sign in'
                            : screen === 'verify'
                              ? 'Verify email'
                              : screen === 'forgot'
                                ? 'Send reset code'
                                : 'Reset password'}
                      </Text>
                      <Icon name="arrow-forward" color="white" size={18} />
                    </>
                  )}
                </Pressable>
                {(screen === 'verify' || screen === 'reset') && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy || cooldown > 0}
                    onPress={() =>
                      void run(async () => {
                        await api(screen === 'verify' ? '/auth/resend' : '/auth/forgot', { email });
                        setResendAt(Date.now() + 60000);
                        setNotice('If a code is needed, a new one has been sent.');
                      })
                    }
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        color: cooldown ? C.muted : C.coral,
                        textAlign: 'center',
                      }}
                    >
                      {' '}
                      {cooldown ? `Resend code in ${cooldown}s` : 'Resend code'}
                    </Text>
                  </Pressable>
                )}
                {(screen === 'signup' || screen === 'signin') && (
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 5,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Text style={{ fontSize: 12, color: C.muted }}>
                      {screen === 'signup' ? 'Already on board?' : 'New to NEXT STOP?'}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => navigate(screen === 'signup' ? 'signin' : 'signup')}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '700', color: C.navy }}>
                        {screen === 'signup' ? 'Sign in' : 'Create an account'}
                      </Text>
                    </Pressable>
                  </View>
                )}
                <View style={a.privacy}>
                  <Icon name="shield-checkmark-outline" size={14} color={C.green} />
                  <Text style={{ fontSize: 10, color: C.muted }}>Your trip is yours to share.</Text>
                </View>
              </View>
            </View>
          </View>
          <Text style={a.footer}>A better way to get there. Together.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const a = StyleSheet.create({
  page: { maxWidth: 1280, width: '100%', alignSelf: 'center', gap: 30 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  trust: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  greenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  trustText: { fontSize: 10, color: C.muted },
  grid: {
    gap: 0,
    borderRadius: 30,
    overflow: 'hidden',
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#E7E8E3',
  },
  story: { flex: 1, backgroundColor: C.navy, padding: 40, gap: 23 },
  storyTag: { alignSelf: 'flex-start', padding: 10, borderRadius: 20, backgroundColor: '#20374C' },
  storyTitle: {
    color: 'white',
    fontWeight: '700',
    fontSize: 53,
    lineHeight: 60,
    letterSpacing: -2,
  },
  storyBody: { fontSize: 16, color: '#B8C6D3', lineHeight: 26, maxWidth: 340 },
  storyDivider: { height: 1, backgroundColor: '#2C4258' },
  storyIcon: {
    width: 44,
    height: 44,
    backgroundColor: '#223B50',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formOuter: { flex: 1.12, paddingHorizontal: 24, paddingVertical: 36, justifyContent: 'center' },
  form: { maxWidth: 400, width: '100%', alignSelf: 'center', gap: 19 },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  stepDot: {
    width: 19,
    height: 19,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formEyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 1.3, color: C.coral },
  heading: { fontWeight: '700', letterSpacing: -1.1, color: C.navy, lineHeight: 39 },
  description: { fontSize: 13, lineHeight: 22, color: C.muted },
  label: { fontSize: 11, fontWeight: '600', color: C.navy },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1,
    borderColor: '#E7ECEF',
    backgroundColor: '#FAFBFC',
    borderRadius: 13,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  input: { flex: 1, fontSize: 13, color: C.navy, paddingVertical: 15, minWidth: 0 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orLine: { height: 1, backgroundColor: C.line, flex: 1 },
  primary: {
    minHeight: 53,
    borderRadius: 14,
    backgroundColor: C.coral,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 15,
  },
  primaryText: { fontSize: 14, fontWeight: '700', color: 'white' },
  error: { padding: 13, borderRadius: 12, backgroundColor: '#FFF0EB' },
  errorText: { fontSize: 12, lineHeight: 19, color: '#AD3B2B' },
  otp: {
    backgroundColor: '#FAFBFC',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    height: 64,
    fontSize: 29,
    fontWeight: '600',
    letterSpacing: 12,
    textAlign: 'center',
    color: C.navy,
  },
  privacy: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 7,
  },
  footer: { textAlign: 'center', fontSize: 11, color: C.muted, marginBottom: 15 },
});
