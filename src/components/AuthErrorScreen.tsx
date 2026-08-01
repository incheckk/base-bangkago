import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from './PrimaryButton';
import { ScreenContainer } from './ScreenContainer';
import { ErrorState } from './States';
import { signOut } from '../services/auth.service';
import { colors, spacing, typography } from '../theme/tokens';

/**
 * Terminal error screen for the auth/profile layer.
 *
 * The guards render this when the profile subscription fails. It must always
 * offer a way out: signing out is an Auth call, so it still works when every
 * Firestore read is being denied. Without it a rules error is unrecoverable
 * without deleting the app.
 */
export function AuthErrorScreen({ message }: { message: string }) {
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
    } catch {
      setBusy(false);
    }
  }

  const isPermission = /permission|insufficient/i.test(message);

  return (
    <ScreenContainer>
      <ErrorState message={message} />

      {isPermission && (
        <View style={styles.hint}>
          <Text style={styles.hintText}>
            This usually means the Firestore security rules have not been deployed.
            See firestore.rules in the project root.
          </Text>
        </View>
      )}

      <PrimaryButton
        label="Sign out"
        variant="secondary"
        onPress={handleSignOut}
        loading={busy}
        style={{ marginBottom: spacing.xl }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  hint: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  hintText: { ...typography.caption, color: colors.textMuted, textAlign: 'center', fontSize: 12 },
});
