import React, { useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { C } from '../../components/Brand';
import { Button, Icon, s } from '../../components/UI';
import type { PhotoShows, PhotoSource, Stop } from '../../domain';
import { actionKey } from '../workspace/types';
import type { Mutate } from '../workspace/types';

const SOURCES: { value: Exclude<PhotoSource, ''>; label: string; hint: string }[] = [
  { value: 'own', label: 'Taken by our team', hint: 'You or your transport staff took it' },
  {
    value: 'institution',
    label: 'Institution-owned',
    hint: 'From your institution, with permission',
  },
  { value: 'licensed', label: 'Openly licensed', hint: 'e.g. Wikimedia Commons, with its licence' },
];
const SHOWS: { value: Exclude<PhotoShows, ''>; label: string }[] = [
  { value: 'boarding', label: 'The boarding area itself' },
  { value: 'landmark', label: 'A nearby landmark' },
];
interface Draft {
  alt: string;
  shows: PhotoShows;
  source: PhotoSource;
  credit: string;
  license: string;
  sourceUrl: string;
}
const fromStop = (stop: Stop): Draft => ({
  alt: stop.photo?.alt || '',
  shows: stop.photo?.shows || '',
  source: stop.photo?.source || '',
  credit: stop.photo?.credit || '',
  license: stop.photo?.license || '',
  sourceUrl: stop.photo?.sourceUrl || '',
});

/** Re-encodes on the device at two sizes. Re-encoding drops all metadata (including GPS); the
 * server removes any that remains. */
async function prepare(uri: string, width: number) {
  const full = ImageManipulator.manipulate(uri);
  if (width > 1600) full.resize({ width: 1600 });
  const big = await (
    await full.renderAsync()
  ).saveAsync({
    compress: 0.72,
    format: SaveFormat.JPEG,
    base64: true,
  });
  const small = ImageManipulator.manipulate(uri);
  small.resize({ width: 480 });
  const thumb = await (
    await small.renderAsync()
  ).saveAsync({
    compress: 0.68,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!big.base64 || !thumb.base64) throw Error('The photo could not be prepared.');
  return { data: big.base64, thumbData: thumb.base64, preview: big.uri };
}

/** Administrators: a stop's photo, where it came from, and its verification. */
export default function PhotoManager({
  stop,
  busy,
  pending,
  mutate,
}: {
  stop: Stop;
  busy: boolean;
  pending: string;
  mutate: Mutate;
}) {
  const p = stop.photo;
  const [draft, setDraft] = useState<Draft>(() => fromStop(stop));
  const [chosen, setChosen] = useState<{ data: string; thumbData: string; preview: string } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const set = (k: keyof Draft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const fields = {
    alt: draft.alt.trim(),
    shows: draft.shows,
    source: draft.source,
    credit: draft.credit.trim(),
    license: draft.license.trim(),
    sourceUrl: draft.sourceUrl.trim(),
  };
  async function choose(camera: boolean) {
    setError('');
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw Error('Photo access was not allowed.');
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 1,
        exif: false,
      };
      const result = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      setPreparing(true);
      setChosen(await prepare(asset.uri, asset.width || 4000));
      if (camera && !draft.source) setDraft((d) => ({ ...d, source: 'own' }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  }
  async function upload() {
    if (!chosen) return;
    const ok = await mutate(
      '/stops/photo',
      {
        stopId: stop.id,
        contentType: 'image/jpeg',
        data: chosen.data,
        thumbType: 'image/jpeg',
        thumbData: chosen.thumbData,
        ...fields,
      },
      'Photo saved. Check it and verify it when it’s right; riders see it only after that.',
    );
    if (ok) setChosen(null);
  }
  const verifying = pending === actionKey('/stops/photo/verify');
  const missingNow = [
    fields.alt.length < 10 ? 'a description (alt text) of at least 10 characters' : '',
    !fields.source ? 'who took or owns it' : '',
    fields.source && fields.source !== 'own' && !fields.credit ? 'the credit' : '',
    fields.source === 'licensed' && !fields.license ? 'the licence' : '',
    fields.source === 'licensed' && !fields.sourceUrl ? 'a link to the original' : '',
    !fields.shows ? 'what it shows' : '',
  ].filter(Boolean);
  const unsaved =
    !!p &&
    (fields.alt !== p.alt ||
      fields.shows !== p.shows ||
      fields.source !== p.source ||
      fields.credit !== p.credit ||
      fields.license !== p.license ||
      fields.sourceUrl !== p.sourceUrl);

  return (
    <View style={{ gap: 12 }}>
      <Text style={s.heading}>Photo</Text>
      <Text style={s.caption}>
        Use a real photo of this stop, ideally the boarding area or a landmark riders will
        recognise. Use your own photos or ones you have permission to use; never AI-generated images
        or random search results. Riders see it only after you verify it.
      </Text>

      {!p && stop.photo_suggestion && !chosen && (
        <View style={{ gap: 8, padding: 12, borderRadius: 14, backgroundColor: '#F2F5F8' }}>
          <Text style={s.heading}>Researched photo available</Text>
          <Text style={s.body}>{stop.photo_suggestion.alt}</Text>
          <Text style={s.caption}>
            {stop.photo_suggestion.credit} · {stop.photo_suggestion.license}. How it was matched:{' '}
            {stop.photo_suggestion.match}
          </Text>
          <Button
            secondary
            icon="image-outline"
            label="Use this photo (unverified)"
            loadingLabel="Adding…"
            loading={pending === actionKey('/stops/photo/suggested')}
            disabled={busy}
            onPress={() =>
              void mutate(
                '/stops/photo/suggested',
                { stopId: stop.id },
                'Photo added. Check it matches the stop, then verify it.',
              )
            }
          />
        </View>
      )}

      {chosen && (
        <Image
          source={{ uri: chosen.preview }}
          accessibilityLabel="The photo you chose, not yet saved"
          style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 14 }}
          resizeMode="cover"
        />
      )}
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Button
            secondary
            icon="camera-outline"
            label={p || chosen ? 'Take a new photo' : 'Take photo'}
            disabled={busy || preparing}
            onPress={() => void choose(true)}
          />
        </View>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Button
            secondary
            icon="image-outline"
            label={p || chosen ? 'Choose another' : 'Choose photo'}
            disabled={busy || preparing}
            onPress={() => void choose(false)}
          />
        </View>
      </View>
      {preparing && <Text style={s.caption}>Preparing the photo…</Text>}

      {(p || chosen) && (
        <View style={{ gap: 10 }}>
          <Text style={s.label}>DESCRIPTION FOR SCREEN READERS (ALT TEXT)</Text>
          <TextInput
            accessibilityLabel="Photo description for screen readers"
            multiline
            value={draft.alt}
            onChangeText={set('alt')}
            maxLength={200}
            placeholder="e.g. Covered bench beside the chapel crosswalk, facing the road"
            placeholderTextColor="#97A2AC"
            style={[s.input, { minHeight: 60, textAlignVertical: 'top' }]}
          />
          <Text style={s.label}>THE PHOTO SHOWS</Text>
          <Choice options={SHOWS} value={draft.shows} onChange={set('shows')} />
          <Text style={s.label}>SOURCE</Text>
          <Choice options={SOURCES} value={draft.source} onChange={set('source')} />
          {(draft.source === 'institution' ||
            draft.source === 'licensed' ||
            draft.source === 'own') && (
            <>
              <Text style={s.label}>
                {draft.source === 'own' ? 'PHOTOGRAPHER (OPTIONAL)' : 'CREDIT / ATTRIBUTION'}
              </Text>
              <TextInput
                accessibilityLabel="Credit or attribution"
                value={draft.credit}
                onChangeText={set('credit')}
                maxLength={120}
                placeholder={
                  draft.source === 'licensed' ? 'Author name, as the licence requires' : 'Name'
                }
                placeholderTextColor="#97A2AC"
                style={s.input}
              />
            </>
          )}
          {(draft.source === 'licensed' || draft.source === 'institution') && (
            <>
              <Text style={s.label}>
                {draft.source === 'licensed' ? 'LICENCE' : 'PERMISSION (OPTIONAL)'}
              </Text>
              <TextInput
                accessibilityLabel="Licence or permission"
                value={draft.license}
                onChangeText={set('license')}
                maxLength={60}
                placeholder={
                  draft.source === 'licensed'
                    ? 'e.g. CC BY-SA 4.0'
                    : 'e.g. Used with permission of Communications'
                }
                placeholderTextColor="#97A2AC"
                style={s.input}
              />
              <Text style={s.label}>
                {draft.source === 'licensed' ? 'LINK TO THE ORIGINAL' : 'LINK (OPTIONAL)'}
              </Text>
              <TextInput
                accessibilityLabel="Link to the original"
                value={draft.sourceUrl}
                onChangeText={set('sourceUrl')}
                maxLength={300}
                autoCapitalize="none"
                keyboardType="url"
                placeholder="https://"
                placeholderTextColor="#97A2AC"
                style={s.input}
              />
            </>
          )}
        </View>
      )}

      {chosen ? (
        <Button
          icon="cloud-upload-outline"
          label={p ? 'Replace photo' : 'Save photo'}
          loadingLabel="Uploading…"
          loading={pending === actionKey('/stops/photo')}
          disabled={busy}
          onPress={() => void upload()}
        />
      ) : (
        p && (
          <>
            {unsaved && (
              <Button
                secondary
                label="Save photo details"
                loadingLabel="Saving…"
                loading={pending === actionKey('/stops/photo/details')}
                disabled={busy}
                onPress={() =>
                  void mutate(
                    '/stops/photo/details',
                    { stopId: stop.id, ...fields },
                    'Photo details saved. Verify the photo again when it’s right.',
                  )
                }
              />
            )}
            <View style={[s.row, { justifyContent: 'flex-start', gap: 8 }]}>
              <Icon
                name={p.verified ? 'checkmark-circle' : 'alert-circle-outline'}
                color={p.verified ? C.green : '#8A5A00'}
                size={18}
              />
              <Text style={[s.caption, { flex: 1 }]}>
                {p.verified
                  ? `Verified by ${p.verifiedBy || 'an administrator'}${p.verifiedAt ? ` on ${new Date(p.verifiedAt).toLocaleDateString()}` : ''}. Riders see it.`
                  : 'Not verified: riders don’t see this photo.'}
              </Text>
            </View>
            {!p.verified && (
              <>
                {(unsaved ? missingNow : p.missing || []).length > 0 && (
                  <Text style={[s.caption, { color: '#8A5A00' }]}>
                    Before verifying, add {(unsaved ? missingNow : p.missing || []).join(', ')}
                    {unsaved ? ', then save the details' : ''}.
                  </Text>
                )}
                <Button
                  tone="navy"
                  icon="checkmark-done-outline"
                  label="Verify: this photo shows this stop"
                  loadingLabel="Verifying…"
                  loading={verifying}
                  disabled={busy || unsaved || !!p.missing?.length || stop.status === 'draft'}
                  onPress={() =>
                    void mutate(
                      '/stops/photo/verify',
                      { stopId: stop.id, version: p.version },
                      'Photo verified. Riders now see it.',
                    )
                  }
                />
                {stop.status === 'draft' && (
                  <Text style={s.caption}>
                    Confirm the boarding point before verifying the photo.
                  </Text>
                )}
              </>
            )}
            <Button
              secondary
              icon="trash-outline"
              label="Remove photo"
              disabled={busy}
              onPress={() =>
                void mutate('/stops/photo/delete', { stopId: stop.id }, 'Photo removed.')
              }
            />
          </>
        )
      )}
      {!!error && <Text style={[s.caption, { color: '#C2381F' }]}>{error}</Text>}
    </View>
  );
}

function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: string;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ gap: 6 }} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            aria-checked={on}
            onPress={() => onChange(o.value)}
            style={[s.stopOption, on && { borderColor: C.navy, backgroundColor: '#F2F5F8' }]}
          >
            <Icon
              name={on ? 'radio-button-on' : 'radio-button-off'}
              color={on ? C.navy : C.muted}
            />
            <View style={{ flex: 1 }}>
              <Text style={[s.heading, { fontWeight: on ? '700' : '500' }]}>{o.label}</Text>
              {!!o.hint && <Text style={s.caption}>{o.hint}</Text>}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
