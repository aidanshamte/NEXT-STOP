import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
export const C = {
  navy: '#11243A',
  coral: '#EF543F',
  mint: '#DDF1E8',
  green: '#177754',
  muted: '#72808D',
  paper: '#F5F7F8',
  line: '#E7ECEF',
  blue: '#496AF1',
};
export function Mark({ size = 42 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Rect width="64" height="64" rx="19" fill={C.navy} />
      <Path
        d="M18 45 V20 Q18 17 21 20 L43 44 Q46 47 46 43 V19"
        fill="none"
        stroke={C.coral}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx="18" cy="45" r="4" fill="#fff" />
      <Circle cx="46" cy="19" r="4" fill="#fff" />
    </Svg>
  );
}
export function Brand() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Mark />
      <View>
        <Text style={{ fontSize: 19, fontWeight: '900', letterSpacing: 1.2, color: C.navy }}>
          NEXT STOP<Text style={{ color: C.coral }}>•</Text>
        </Text>
        <Text style={{ fontSize: 10, color: C.muted, letterSpacing: 1.3, marginTop: 2 }}>
          YOUR RIDE. IN SIGHT.
        </Text>
      </View>
    </View>
  );
}
