import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { checkReviewEligibility, fetchReviews, submitReview, type ReviewListingType } from '@/api/reviews';
import { Button } from '@/components/Button';
import { ReviewCard } from '@/components/detail/ReviewCard';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAuthStore } from '@/auth/store';
import { useTheme } from '@/hooks/use-theme';

export function Reviews({ listingType, listingId }: { listingType: ReviewListingType; listingId: string }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  const [writing, setWriting] = useState(false);
  const [name, setName] = useState('');
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reviewsQuery = useQuery({ queryKey: ['reviews', listingType, listingId], queryFn: () => fetchReviews(listingType, listingId) });
  const eligibilityQuery = useQuery({
    queryKey: ['review-eligible', listingType, listingId],
    queryFn: () => checkReviewEligibility(listingType, listingId),
    enabled: signedIn,
  });

  async function handleSubmit() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await submitReview({ listingType, listingId, name: name.trim(), rating, comment: comment.trim() || undefined });
      setWriting(false);
      setComment('');
      queryClient.invalidateQueries({ queryKey: ['reviews', listingType, listingId] });
    } finally {
      setSubmitting(false);
    }
  }

  const reviews = reviewsQuery.data ?? [];

  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="sectionHeading">Reviews {reviews.length > 0 ? `(${reviews.length})` : ''}</ThemedText>

      {reviews.length === 0 && <ThemedText themeColor="textSecondary">No reviews yet.</ThemedText>}
      {reviews.map((review) => (
        <ReviewCard key={review.id} review={review} />
      ))}

      {signedIn && eligibilityQuery.data?.eligible && !writing && (
        <Pressable onPress={() => setWriting(true)}>
          <ThemedText themeColor="primary">Write a review</ThemedText>
        </Pressable>
      )}

      {writing && (
        <View style={[styles.form, { borderColor: theme.border }]}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { borderColor: theme.border, color: theme.text, minHeight: undefined }]}
          />
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((value) => (
              <Pressable key={value} onPress={() => setRating(value)}>
                <ThemedText themeColor={value <= rating ? 'primary' : 'textSecondary'} style={styles.star}>
                  ★
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Share your experience (optional)"
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[styles.input, { borderColor: theme.border, color: theme.text }]}
          />
          <Button label="Submit review" onPress={handleSubmit} loading={submitting} disabled={!name.trim()} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    borderTopWidth: 1,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  stars: {
    flexDirection: 'row',
    gap: 4,
  },
  star: {
    fontSize: 24,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.control,
    padding: Spacing.two,
    minHeight: 60,
    textAlignVertical: 'top',
  },
});
