import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Brand, C } from '../../components/Brand';
import { Button, Icon } from '../../components/UI';
import { api } from '../../services/api';
import type { Institution, Role } from '../../domain';
export default function JoinInstitution({
  name,
  onJoined,
  onSignOut,
}: {
  name: string;
  onJoined: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [role, setRole] = useState<Role>('student'),
    [query, setQuery] = useState(''),
    [institutions, setInstitutions] = useState<Institution[]>([]),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    api<Institution[]>('/institutions')
      .then((value) => {
        if (active) setInstitutions(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function join() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api('/memberships', { institutionId: selected, role });
      await onJoined();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const choices: [Role, React.ComponentProps<typeof Icon>['name'], string, string][] = [
    ['student', 'school-outline', 'Student', 'Find your ride and request your stop.'],
    ['parent', 'heart-outline', 'Parent or trusted contact', 'Follow journeys shared with you.'],
    ['driver', 'bus-outline', 'Driver', 'Keep your riders moving and informed.'],
  ];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F4F0' }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: 24,
          gap: 30,
          maxWidth: 780,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <Brand />
        <View style={j.card}>
          <View style={j.step}>
            <Icon name="checkmark-circle" color={C.green} />
            <Text style={{ fontSize: 11, color: C.green }}>Account verified</Text>
            <Text style={{ fontSize: 10, color: C.muted, marginLeft: 'auto' }}>STEP 3 OF 3</Text>
          </View>
          <Text style={j.title}>Welcome aboard, {name.split(' ')[0]}.</Text>
          <Text style={j.body}>Let’s find your people and your next stop.</Text>
          <Text style={j.label}>HOW WILL YOU USE NEXT STOP?</Text>
          <View style={{ gap: 10 }}>
            {choices.map(([id, icon, title, body]) => (
              <Pressable
                key={id}
                accessibilityRole="radio"
                accessibilityState={{ checked: role === id }}
                aria-checked={role === id}
                onPress={() => setRole(id)}
                style={[
                  j.role,
                  role === id && { borderColor: C.coral, backgroundColor: '#FFF7F3' },
                ]}
              >
                <View
                  style={{
                    width: 43,
                    height: 43,
                    borderRadius: 13,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: role === id ? '#FFE4DA' : C.paper,
                  }}
                >
                  <Icon name={icon} color={role === id ? C.coral : C.muted} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: C.navy }}>{title}</Text>
                  <Text style={{ fontSize: 11, lineHeight: 18, color: C.muted }}>{body}</Text>
                </View>
                <Icon
                  name={role === id ? 'radio-button-on' : 'radio-button-off'}
                  size={19}
                  color={role === id ? C.coral : '#B5BFC8'}
                />
              </Pressable>
            ))}
          </View>
          <Text style={j.label}>YOUR SCHOOL OR COLLEGE</Text>
          <View style={j.search}>
            <Icon name="search-outline" color={C.muted} size={18} />
            <TextInput
              accessibilityLabel="Search schools and colleges"
              placeholder="Search your institution"
              placeholderTextColor="#9AA6AF"
              value={query}
              onChangeText={setQuery}
              style={{ flex: 1, fontSize: 13, color: C.navy, paddingVertical: 14 }}
            />
          </View>
          {loading ? (
            <ActivityIndicator color={C.coral} />
          ) : (
            <View style={{ gap: 8 }}>
              {institutions
                .filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))
                .map((i) => (
                  <Pressable
                    key={i.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected === i.id }}
                    aria-checked={selected === i.id}
                    onPress={() => setSelected(i.id)}
                    style={[j.institution, selected === i.id && { borderColor: C.navy }]}
                  >
                    <Icon name="business-outline" size={20} color={C.navy} />
                    <Text style={{ flex: 1, color: C.navy, fontSize: 13, fontWeight: '500' }}>
                      {i.name}
                    </Text>
                    {selected === i.id && (
                      <Icon name="checkmark-circle" size={19} color={C.green} />
                    )}
                  </Pressable>
                ))}
              {!institutions.length && (
                <Text style={j.body}>
                  Your institution isn’t listed yet. Ask your transport team to enroll your school
                  or college.
                </Text>
              )}
              {institutions.length > 0 &&
                !institutions.some((i) => i.name.toLowerCase().includes(query.toLowerCase())) && (
                  <Text style={j.body}>No matching institution. Try another name.</Text>
                )}
            </View>
          )}
          {!!error && (
            <Text
              accessibilityRole="alert"
              style={{ color: '#AD3B2B', fontSize: 12, lineHeight: 19 }}
            >
              {error}
            </Text>
          )}
          <Button
            label={busy ? 'Joining your community…' : 'Join my community'}
            icon="arrow-forward"
            disabled={!selected || busy}
            onPress={join}
          />
          <Text style={{ fontSize: 11, lineHeight: 18, color: C.muted }}>
            Your institution reviews new memberships. Drivers also need a vehicle assignment;
            parents need a student’s sharing permission.
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void onSignOut()}>
            <Text style={{ fontSize: 12, textAlign: 'center', color: C.muted }}>Sign out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const j = StyleSheet.create({
  card: {
    padding: 25,
    borderWidth: 1,
    borderColor: '#E5E8E9',
    borderRadius: 25,
    backgroundColor: 'white',
    gap: 20,
  },
  step: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  title: { fontSize: 29, fontWeight: '700', letterSpacing: -1, color: C.navy },
  body: { fontSize: 13, color: C.muted, lineHeight: 22 },
  label: { fontSize: 10, color: C.navy, fontWeight: '700', letterSpacing: 1 },
  role: {
    flexDirection: 'row',
    gap: 13,
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 15,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: C.paper,
  },
  institution: {
    padding: 15,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});
