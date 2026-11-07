import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { C } from '../../components/Brand';
import { Button, Card, Field, Icon, s } from '../../components/UI';
import { amenityIcons, amenityLabels } from '../../catalog';
import type { Stop } from '../../domain';
import { actionKey } from '../workspace/types';
import type { Mutate } from '../workspace/types';
import { forgetPhoto } from './StopPhoto';

/** Administrator editing of a stop's rider-facing details. Saving any change clears the
 * verification; verifying records the administrator and date. */
export default function StopEditor({
  org,
  stop,
  busy,
  pending,
  mutate,
}: {
  org: string;
  stop: Stop;
  busy: boolean;
  pending: string;
  mutate: Mutate;
}) {
  const [name, setName] = useState(stop.name);
  const [description, setDescription] = useState(stop.description || '');
  const [accessibility, setAccessibility] = useState(stop.accessibility || '');
  const [amenities, setAmenities] = useState<Record<string, string>>(
    Object.fromEntries((stop.amenities || []).map((a) => [a.key, a.detail])),
  );
  const [photoError, setPhotoError] = useState('');
  const toggle = (key: string) =>
    setAmenities((current) => {
      const next = { ...current };
      if (key in next) delete next[key];
      else next[key] = '';
      return next;
    });
  async function choosePhoto(camera: boolean) {
    setPhotoError('');
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw Error('Photo access was not allowed.');
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
      const result = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets[0]) return;
      // Downscaled and re-encoded on the device: location metadata is not kept.
      const context = ImageManipulator.manipulate(result.assets[0].uri);
      context.resize({ width: 1200 });
      const image = await context.renderAsync();
      const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
      if (!saved.base64) throw Error('The photo could not be prepared.');
      forgetPhoto(org, stop.id);
      await mutate(
        '/stops/photo',
        { stopId: stop.id, contentType: 'image/jpeg', data: saved.base64 },
        'Photo saved. Verify the stop again when it is correct.',
      );
    } catch (e) {
      setPhotoError((e as Error).message);
    }
  }
  return (
    <Card>
      <Text style={s.title}>Edit stop details</Text>
      <Text style={s.caption}>
        Riders see what you enter here. Saving any change marks the stop as unverified until you
        verify it again. Describe only what is actually at the stop.
      </Text>
      <Field label="Stop name" value={name} onChange={setName} />
      <Text style={s.label}>DESCRIPTION</Text>
      <TextInput
        accessibilityLabel="Description"
        multiline
        value={description}
        onChangeText={setDescription}
        maxLength={500}
        placeholder="Where exactly to wait, landmarks"
        placeholderTextColor="#97A2AC"
        style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
      />
      <Text style={s.label}>ACCESSIBILITY NOTES</Text>
      <TextInput
        accessibilityLabel="Accessibility notes"
        multiline
        value={accessibility}
        onChangeText={setAccessibility}
        maxLength={300}
        placeholder="Step-free route, curb height, obstacles"
        placeholderTextColor="#97A2AC"
        style={[s.input, { minHeight: 64, textAlignVertical: 'top' }]}
      />
      <Text style={s.label}>AMENITIES PRESENT</Text>
      {Object.entries(amenityLabels).map(([key, label]) => {
        const on = key in amenities;
        return (
          <View key={key} style={{ gap: 6 }}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              onPress={() => toggle(key)}
              style={[s.stopOption, on && { borderColor: C.navy, backgroundColor: '#F2F5F8' }]}
            >
              <Icon name={on ? 'checkbox' : 'square-outline'} color={on ? C.navy : C.muted} />
              <Icon name={amenityIcons[key]} color={C.muted} size={18} />
              <Text style={[s.heading, { flex: 1, fontWeight: on ? '700' : '500' }]}>{label}</Text>
            </Pressable>
            {on && (
              <TextInput
                accessibilityLabel={`${label} detail`}
                value={amenities[key]}
                onChangeText={(v) => setAmenities((c) => ({ ...c, [key]: v }))}
                maxLength={80}
                placeholder="Optional detail"
                placeholderTextColor="#97A2AC"
                style={[s.input, { minHeight: 40, padding: 10 }]}
              />
            )}
          </View>
        );
      })}
      <Button
        label="Save details"
        loadingLabel="Saving…"
        loading={pending === actionKey('/stops/details')}
        disabled={busy || !name.trim()}
        onPress={() =>
          mutate(
            '/stops/details',
            {
              stopId: stop.id,
              name: name.trim(),
              description,
              accessibility,
              amenities: Object.entries(amenities).map(([key, detail]) => ({ key, detail })),
            },
            'Details saved. Verify them when they are correct.',
          )
        }
      />
      <View style={s.divider} />
      <Text style={s.heading}>Photo</Text>
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Button
            secondary
            icon="camera-outline"
            label="Take photo"
            disabled={busy}
            onPress={() => void choosePhoto(true)}
          />
        </View>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Button
            secondary
            icon="image-outline"
            label="Choose photo"
            disabled={busy}
            onPress={() => void choosePhoto(false)}
          />
        </View>
      </View>
      {!!stop.has_photo && (
        <Button
          secondary
          icon="trash-outline"
          label="Remove photo"
          disabled={busy}
          onPress={() => {
            forgetPhoto(org, stop.id);
            void mutate('/stops/photo/delete', { stopId: stop.id }, 'Photo removed.');
          }}
        />
      )}
      {!!photoError && <Text style={[s.caption, { color: '#C2381F' }]}>{photoError}</Text>}
      <View style={s.divider} />
      <Button
        tone="navy"
        icon="checkmark-done-outline"
        label={stop.details_verified_at ? 'Verified · verify again' : 'Verify details are correct'}
        loadingLabel="Verifying…"
        loading={pending === actionKey('/stops/verify')}
        disabled={busy || stop.status === 'draft'}
        onPress={() => mutate('/stops/verify', { stopId: stop.id }, 'Stop details verified.')}
      />
      {stop.status === 'draft' && (
        <Text style={s.caption}>Confirm this stop’s location in Setup before verifying.</Text>
      )}
    </Card>
  );
}
