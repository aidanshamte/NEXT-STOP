import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../services/api';
import type { GoogleProps } from './GoogleButton';
interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string;
        nonce: string;
        callback: (data: { credential: string }) => void;
        auto_select: boolean;
      }) => void;
      renderButton: (element: HTMLElement, options: object) => void;
    };
  };
}
declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}
let scriptPromise: Promise<void> | null = null;
function loadGoogle() {
  if (window.google) return Promise.resolve();
  if (!scriptPromise)
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        script.remove();
        reject(Error('Google could not load. Please try email instead.'));
      };
      document.head.appendChild(script);
    });
  return scriptPromise;
}
export default function GoogleButton({ clientId, disabled, onCredential, onError }: GoogleProps) {
  const element = useRef<HTMLDivElement>(null),
    credential = useRef(onCredential),
    error = useRef(onError);
  const [revision, setRevision] = useState(0),
    [loadError, setLoadError] = useState('');
  useEffect(() => {
    credential.current = onCredential;
    error.current = onError;
  }, [onCredential, onError]);
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    (async () => {
      try {
        await loadGoogle();
        const { challenge } = await api<{ challenge: string }>('/auth/google/challenge', {});
        if (!active || !element.current) return;
        window.google!.accounts.id.initialize({
          client_id: clientId,
          nonce: challenge,
          auto_select: false,
          callback: (result) => {
            if (!active) return;
            void credential
              .current(result.credential, challenge)
              .catch((e) => error.current((e as Error).message))
              .finally(() => {
                if (active) setRevision((v) => v + 1);
              });
          },
        });
        window.google!.accounts.id.renderButton(element.current, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: 320,
        });
      } catch (e) {
        if (active) setLoadError((e as Error).message);
      }
    })();
    return () => {
      active = false;
    };
  }, [clientId, revision]);
  if (loadError) return <Text style={{ fontSize: 12, color: '#72808D' }}>{loadError}</Text>;
  // Without a configured client there is no Google button; the screen explains the email path.
  if (!clientId) return null;
  return (
    <View
      style={{
        minHeight: 44,
        alignItems: 'center',
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      <div ref={element} aria-label="Continue with Google" />
    </View>
  );
}
