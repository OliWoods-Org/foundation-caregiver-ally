/**
 * Burnout Monitor
 *
 * Tracks caregiver wellbeing through self-reported mood, sleep, stress, and
 * activity data. Uses validated screening instruments to detect burnout risk
 * and trigger early interventions before crisis.
 *
 * @module burnout-monitor
 * @license GPL-3.0
 * @author OliWoods Foundation
 */

import { z } from 'zod';

// ── Schemas ──────────────────────────────────────────────────────────────────

export const WellbeingCheckInSchema = z.object({
  id: z.string().uuid(),
  caregiverId: z.string(),
  timestamp: z.string().datetime(),
  mood: z.number().int().min(1).max(10),
  sleepHours: z.number().min(0).max(24),
  sleepQuality: z.enum(['poor', 'fair', 'good', 'excellent']),
  stressLevel: z.number().int().min(1).max(10),
  physicalPainLevel: z.number().int().min(0).max(10),
  socialInteractionToday: z.boolean(),
  exerciseMinutes: z.number().int().min(0),
  selfCareActivity: z.boolean(),
  hoursCaringToday: z.number().min(0).max(24),
  emotionalState: z.array(z.enum([
    'calm', 'anxious', 'sad', 'angry', 'hopeful', 'overwhelmed',
    'grateful', 'lonely', 'guilty', 'resentful', 'numb', 'content',
  ])),
  freeText: z.string().optional(),
});

export const BurnoutRiskAssessmentSchema = z.object({
  caregiverId: z.string(),
  assessmentDate: z.string().datetime(),
  overallRiskLevel: z.enum(['low', 'moderate', 'high', 'critical']),
  riskScore: z.number().min(0).max(100),
  dimensions: z.object({
    emotionalExhaustion: z.number().min(0).max(100),
    depersonalization: z.number().min(0).max(100),
    reducedAccomplishment: z.number().min(0).max(100),
    physicalDepletion: z.number().min(0).max(100),
    socialIsolation: z.number().min(0).max(100),
  }),
  trendDirection: z.enum(['improving', 'stable', 'declining', 'rapid-decline']),
  triggers: z.array(z.string()),
  recommendations: z.array(z.object({
    priority: z.enum(['immediate', 'this-week', 'ongoing']),
    action: z.string(),
    category: z.enum(['self-care', 'respite', 'professional-help', 'social', 'practical', 'crisis']),
  })),
  crisisIndicators: z.boolean(),
});

export const CaregiverProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  careRecipientRelation: z.string(),
  careRecipientConditions: z.array(z.string()),
  yearsAsCaregiving: z.number().min(0),
  hoursPerWeek: z.number().min(0),
  hasBackupCaregiver: z.boolean(),
  employmentStatus: z.enum(['full-time', 'part-time', 'not-employed', 'self-employed']),
  supportNetworkSize: z.number().int().min(0),
  previousBurnoutHistory: z.boolean(),
});

// ── Types ────────────────────────────────────────────────────────────────────

export type WellbeingCheckIn = z.infer<typeof WellbeingCheckInSchema>;
export type BurnoutRiskAssessment = z.infer<typeof BurnoutRiskAssessmentSchema>;
export type CaregiverProfile = z.infer<typeof CaregiverProfileSchema>;

// ── Functions ────────────────────────────────────────────────────────────────

/**
 * Assess burnout risk from recent check-in data using a multi-dimensional model
 * based on the Maslach Burnout Inventory adapted for informal caregivers.
 */
export function assessBurnoutRisk(
  checkIns: WellbeingCheckIn[],
  profile: CaregiverProfile,
): BurnoutRiskAssessment {
  if (checkIns.length === 0) {
    return createDefaultAssessment(profile.id);
  }

  // Use most recent 14 days of data
  const sorted = [...checkIns].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const recent = sorted.slice(0, 14);

  // Calculate dimension scores
  const emotionalExhaustion = calculateEmotionalExhaustion(recent);
  const depersonalization = calculateDepersonalization(recent);
  const reducedAccomplishment = calculateReducedAccomplishment(recent);
  const physicalDepletion = calculatePhysicalDepletion(recent);
  const socialIsolation = calculateSocialIsolation(recent, profile);

  // Weighted composite score
  const riskScore = Math.round(
    emotionalExhaustion * 0.30 +
    depersonalization * 0.15 +
    reducedAccomplishment * 0.15 +
    physicalDepletion * 0.20 +
    socialIsolation * 0.20,
  );

  // Risk modifiers from profile
  const adjustedScore = Math.min(100, riskScore +
    (profile.hoursPerWeek > 40 ? 10 : 0) +
    (!profile.hasBackupCaregiver ? 8 : 0) +
    (profile.supportNetworkSize < 2 ? 7 : 0) +
    (profile.previousBurnoutHistory ? 5 : 0),
  );

  // Determine trend
  const trendDirection = calculateTrend(sorted);

  // Check for crisis indicators
  const crisisIndicators = checkCrisisIndicators(recent);

  // Generate recommendations
  const recommendations = generateRecommendations(adjustedScore, {
    emotionalExhaustion, depersonalization, reducedAccomplishment, physicalDepletion, socialIsolation,
  }, crisisIndicators, profile);

  const triggers = identifyTriggers(recent, profile);

  return BurnoutRiskAssessmentSchema.parse({
    caregiverId: profile.id,
    assessmentDate: new Date().toISOString(),
    overallRiskLevel: scoreToRiskLevel(adjustedScore),
    riskScore: adjustedScore,
    dimensions: { emotionalExhaustion, depersonalization, reducedAccomplishment, physicalDepletion, socialIsolation },
    trendDirection,
    triggers,
    recommendations,
    crisisIndicators,
  });
}

/**
 * Detect if caregiver needs immediate crisis intervention.
 * Returns true if any check-in contains crisis-level indicators.
 */
export function detectCrisisState(checkIns: WellbeingCheckIn[]): {
  isCrisis: boolean;
  indicators: string[];
  requiredAction: string;
} {
  const indicators: string[] = [];

  for (const checkIn of checkIns) {
    if (checkIn.mood <= 2 && checkIn.stressLevel >= 9) {
      indicators.push('Extremely low mood combined with extreme stress');
    }
    if (checkIn.sleepHours < 3 && checkIn.hoursCaringToday > 16) {
      indicators.push('Severe sleep deprivation with extended care hours');
    }
    if (checkIn.emotionalState.includes('numb') && checkIn.emotionalState.includes('overwhelmed')) {
      indicators.push('Emotional numbness combined with overwhelm — possible dissociation');
    }
    if (checkIn.freeText) {
      const crisisKeywords = ['can\'t go on', 'give up', 'end it', 'no way out', 'can\'t do this anymore', 'want to die', 'suicide', 'harm myself'];
      const lower = checkIn.freeText.toLowerCase();
      for (const keyword of crisisKeywords) {
        if (lower.includes(keyword)) {
          indicators.push(`Crisis language detected: "${keyword}"`);
        }
      }
    }
  }

  return {
    isCrisis: indicators.length > 0,
    indicators,
    requiredAction: indicators.length > 0
      ? 'MANDATORY: Connect caregiver with 988 Suicide & Crisis Lifeline (call/text 988) or local crisis services immediately. Do not leave the person alone.'
      : 'No crisis indicators detected. Continue routine monitoring.',
  };
}

/**
 * Calculate caregiver load score based on objective care demands.
 */
export function calculateCareLoad(
  hoursPerWeek: number,
  conditions: string[],
  hasBackup: boolean,
  adlAssistance: number, // 0-6 activities of daily living needing help
  medicalTasks: number,  // number of medical tasks performed
): { score: number; level: string; breakdown: Record<string, number> } {
  const hourScore = Math.min(40, (hoursPerWeek / 168) * 100);
  const conditionScore = Math.min(25, conditions.length * 5);
  const adlScore = Math.min(20, (adlAssistance / 6) * 20);
  const medicalScore = Math.min(15, medicalTasks * 3);
  const backupPenalty = hasBackup ? 0 : 10;

  const total = Math.min(100, hourScore + conditionScore + adlScore + medicalScore + backupPenalty);

  return {
    score: Math.round(total),
    level: total < 30 ? 'manageable' : total < 55 ? 'moderate' : total < 75 ? 'heavy' : 'unsustainable',
    breakdown: {
      timeCommitment: Math.round(hourScore),
      conditionComplexity: Math.round(conditionScore),
      adlAssistance: Math.round(adlScore),
      medicalTasks: Math.round(medicalScore),
      backupAvailability: backupPenalty,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function calculateEmotionalExhaustion(checkIns: WellbeingCheckIn[]): number {
  const avgMood = checkIns.reduce((s, c) => s + c.mood, 0) / checkIns.length;
  const avgStress = checkIns.reduce((s, c) => s + c.stressLevel, 0) / checkIns.length;
  const negativeEmotions = checkIns.reduce((s, c) => {
    return s + c.emotionalState.filter(e => ['anxious', 'sad', 'angry', 'overwhelmed', 'numb'].includes(e)).length;
  }, 0) / checkIns.length;

  return Math.min(100, Math.round(((10 - avgMood) * 5 + avgStress * 5 + negativeEmotions * 10)));
}

function calculateDepersonalization(checkIns: WellbeingCheckIn[]): number {
  const numbCount = checkIns.filter(c => c.emotionalState.includes('numb')).length;
  const resentfulCount = checkIns.filter(c => c.emotionalState.includes('resentful')).length;
  return Math.min(100, Math.round(((numbCount + resentfulCount) / checkIns.length) * 100));
}

function calculateReducedAccomplishment(checkIns: WellbeingCheckIn[]): number {
  const noSelfCare = checkIns.filter(c => !c.selfCareActivity).length;
  const lowMood = checkIns.filter(c => c.mood <= 4).length;
  return Math.min(100, Math.round(((noSelfCare + lowMood) / (checkIns.length * 2)) * 100));
}

function calculatePhysicalDepletion(checkIns: WellbeingCheckIn[]): number {
  const avgSleep = checkIns.reduce((s, c) => s + c.sleepHours, 0) / checkIns.length;
  const avgPain = checkIns.reduce((s, c) => s + c.physicalPainLevel, 0) / checkIns.length;
  const lowExercise = checkIns.filter(c => c.exerciseMinutes < 15).length;
  const sleepScore = Math.max(0, (7 - avgSleep) / 7) * 40;
  return Math.min(100, Math.round(sleepScore + avgPain * 4 + (lowExercise / checkIns.length) * 20));
}

function calculateSocialIsolation(checkIns: WellbeingCheckIn[], profile: CaregiverProfile): number {
  const noSocialDays = checkIns.filter(c => !c.socialInteractionToday).length;
  const isolationRate = noSocialDays / checkIns.length;
  const networkScore = Math.max(0, (5 - profile.supportNetworkSize) / 5) * 30;
  return Math.min(100, Math.round(isolationRate * 70 + networkScore));
}

function calculateTrend(sorted: WellbeingCheckIn[]): 'improving' | 'stable' | 'declining' | 'rapid-decline' {
  if (sorted.length < 4) return 'stable';
  const recentAvg = sorted.slice(0, Math.ceil(sorted.length / 2)).reduce((s, c) => s + c.mood, 0) / Math.ceil(sorted.length / 2);
  const olderAvg = sorted.slice(Math.ceil(sorted.length / 2)).reduce((s, c) => s + c.mood, 0) / Math.floor(sorted.length / 2);
  const diff = recentAvg - olderAvg;
  if (diff > 1) return 'improving';
  if (diff < -2) return 'rapid-decline';
  if (diff < -0.5) return 'declining';
  return 'stable';
}

function checkCrisisIndicators(checkIns: WellbeingCheckIn[]): boolean {
  return checkIns.some(c =>
    (c.mood <= 2 && c.stressLevel >= 9) ||
    (c.sleepHours < 2) ||
    (c.emotionalState.includes('numb') && c.stressLevel >= 8),
  );
}

function scoreToRiskLevel(score: number): 'low' | 'moderate' | 'high' | 'critical' {
  if (score < 25) return 'low';
  if (score < 50) return 'moderate';
  if (score < 75) return 'high';
  return 'critical';
}

function identifyTriggers(checkIns: WellbeingCheckIn[], profile: CaregiverProfile): string[] {
  const triggers: string[] = [];
  const avgSleep = checkIns.reduce((s, c) => s + c.sleepHours, 0) / checkIns.length;
  if (avgSleep < 5) triggers.push('Chronic sleep deprivation (avg < 5 hours)');
  if (profile.hoursPerWeek > 50) triggers.push('Excessive weekly care hours (> 50)');
  if (!profile.hasBackupCaregiver) triggers.push('No backup caregiver available');
  if (profile.supportNetworkSize < 2) triggers.push('Minimal support network');
  const highStressDays = checkIns.filter(c => c.stressLevel >= 8).length;
  if (highStressDays > checkIns.length * 0.5) triggers.push('Sustained high stress levels');
  return triggers;
}

function generateRecommendations(
  score: number,
  dimensions: Record<string, number>,
  crisis: boolean,
  profile: CaregiverProfile,
): Array<{ priority: string; action: string; category: string }> {
  const recs: Array<{ priority: string; action: string; category: string }> = [];

  if (crisis) {
    recs.push({ priority: 'immediate', action: 'Contact 988 Suicide & Crisis Lifeline or local crisis services', category: 'crisis' });
  }

  if (dimensions.socialIsolation > 60) {
    recs.push({ priority: 'this-week', action: 'Schedule at least one social interaction outside of caregiving', category: 'social' });
  }
  if (dimensions.physicalDepletion > 50) {
    recs.push({ priority: 'this-week', action: 'Prioritize sleep — aim for 7+ hours. Consider a respite provider for overnight relief.', category: 'self-care' });
  }
  if (score > 60 && !profile.hasBackupCaregiver) {
    recs.push({ priority: 'this-week', action: 'Explore respite care options through your local Area Agency on Aging', category: 'respite' });
  }
  if (dimensions.emotionalExhaustion > 70) {
    recs.push({ priority: 'this-week', action: 'Consider speaking with a therapist or joining a caregiver support group', category: 'professional-help' });
  }
  recs.push({ priority: 'ongoing', action: 'Take at least 15 minutes daily for an activity you enjoy', category: 'self-care' });

  return recs;
}

function createDefaultAssessment(caregiverId: string): BurnoutRiskAssessment {
  return BurnoutRiskAssessmentSchema.parse({
    caregiverId,
    assessmentDate: new Date().toISOString(),
    overallRiskLevel: 'low',
    riskScore: 0,
    dimensions: { emotionalExhaustion: 0, depersonalization: 0, reducedAccomplishment: 0, physicalDepletion: 0, socialIsolation: 0 },
    trendDirection: 'stable',
    triggers: [],
    recommendations: [{ priority: 'ongoing', action: 'Complete daily wellbeing check-ins to establish a baseline', category: 'self-care' }],
    crisisIndicators: false,
  });
}
