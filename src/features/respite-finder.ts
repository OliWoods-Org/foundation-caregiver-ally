/**
 * Respite Finder
 *
 * Locates respite care resources matched to caregiver situation, including
 * in-home care, adult day programs, overnight facilities, and emergency respite.
 * Integrates with government benefit programs for cost reduction.
 *
 * @module respite-finder
 * @license GPL-3.0
 * @author OliWoods Foundation
 */

import { z } from 'zod';

// ── Schemas ──────────────────────────────────────────────────────────────────

export const RespiteProviderSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.enum(['in-home', 'adult-day-program', 'overnight-facility', 'emergency-respite', 'volunteer', 'faith-based']),
  address: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zip: z.string(),
    lat: z.number(),
    lng: z.number(),
  }),
  phone: z.string(),
  website: z.string().url().optional(),
  services: z.array(z.string()),
  specializations: z.array(z.enum([
    'dementia', 'alzheimers', 'physical-disability', 'developmental-disability',
    'mental-health', 'pediatric', 'veteran', 'hospice', 'medical-complex',
  ])),
  acceptsMedicaid: z.boolean(),
  acceptsMedicare: z.boolean(),
  slidingScale: z.boolean(),
  hourlyRate: z.number().nonnegative().optional(),
  dailyRate: z.number().nonnegative().optional(),
  availability: z.enum(['immediate', 'within-week', 'waitlist', 'unknown']),
  rating: z.number().min(0).max(5).optional(),
  verified: z.boolean(),
  lastVerified: z.string().datetime().optional(),
});

export const RespiteSearchCriteriaSchema = z.object({
  location: z.object({ lat: z.number(), lng: z.number() }),
  radiusMiles: z.number().positive().default(25),
  careRecipientNeeds: z.array(z.string()),
  preferredType: z.array(z.enum(['in-home', 'adult-day-program', 'overnight-facility', 'emergency-respite', 'volunteer', 'faith-based'])).optional(),
  maxHourlyRate: z.number().nonnegative().optional(),
  requiresMedicaid: z.boolean().default(false),
  requiresMedicare: z.boolean().default(false),
  urgency: z.enum(['emergency', 'this-week', 'planning-ahead']).default('planning-ahead'),
});

export const RespiteMatchResultSchema = z.object({
  provider: RespiteProviderSchema,
  distanceMiles: z.number().nonnegative(),
  matchScore: z.number().min(0).max(100),
  matchReasons: z.array(z.string()),
  estimatedCost: z.object({
    hourly: z.number().nonnegative().optional(),
    daily: z.number().nonnegative().optional(),
    financialAssistanceAvailable: z.boolean(),
    assistancePrograms: z.array(z.string()),
  }),
});

export const BenefitProgramSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['federal', 'state', 'local', 'nonprofit', 'va']),
  description: z.string(),
  eligibilityCriteria: z.array(z.string()),
  maxBenefitAmount: z.string(),
  applicationUrl: z.string().url().optional(),
  phone: z.string().optional(),
});

// ── Types ────────────────────────────────────────────────────────────────────

export type RespiteProvider = z.infer<typeof RespiteProviderSchema>;
export type RespiteSearchCriteria = z.infer<typeof RespiteSearchCriteriaSchema>;
export type RespiteMatchResult = z.infer<typeof RespiteMatchResultSchema>;
export type BenefitProgram = z.infer<typeof BenefitProgramSchema>;

// ── Benefit Programs Database ────────────────────────────────────────────────

const BENEFIT_PROGRAMS: BenefitProgram[] = [
  {
    id: 'nfcsp',
    name: 'National Family Caregiver Support Program (NFCSP)',
    type: 'federal',
    description: 'Provides respite care, counseling, and supplemental services to family caregivers through Area Agencies on Aging.',
    eligibilityCriteria: ['Primary caregiver for adult 60+', 'Or grandparent/relative caregiver for child 18 or younger'],
    maxBenefitAmount: 'Varies by state — typically $2,000-$5,000/year for respite',
    applicationUrl: 'https://eldercare.acl.gov',
    phone: '1-800-677-1116',
  },
  {
    id: 'va-caregiver',
    name: 'VA Program of Comprehensive Assistance for Family Caregivers',
    type: 'va',
    description: 'Monthly stipend, health insurance, respite care (up to 30 days/year), and mental health counseling for caregivers of eligible veterans.',
    eligibilityCriteria: ['Veteran with serious injury from military service', 'Caregiver provides personal care services'],
    maxBenefitAmount: 'Monthly stipend $1,900-$3,200+ based on care needs; 30 days respite/year',
    applicationUrl: 'https://www.caregiver.va.gov',
    phone: '1-855-260-3274',
  },
  {
    id: 'medicaid-hcbs',
    name: 'Medicaid Home and Community-Based Services (HCBS) Waivers',
    type: 'state',
    description: 'State-administered programs providing respite care, personal care, adult day services, and other supports for Medicaid-eligible individuals.',
    eligibilityCriteria: ['Care recipient must be Medicaid eligible', 'Must meet state nursing facility level of care criteria'],
    maxBenefitAmount: 'Varies widely by state — can cover full cost of respite',
  },
  {
    id: 'lifespan-respite',
    name: 'Lifespan Respite Care Program',
    type: 'federal',
    description: 'Grants to states to improve access to respite care for all family caregivers regardless of age or disability of care recipient.',
    eligibilityCriteria: ['Family caregiver in participating state', 'No age or diagnosis restrictions'],
    maxBenefitAmount: 'Varies by state grant funding',
    applicationUrl: 'https://archrespite.org/lifespan-respite-care-program',
  },
];

// ── Functions ────────────────────────────────────────────────────────────────

/**
 * Search for respite care providers matching caregiver criteria.
 * Returns results ranked by match score considering distance, specialization,
 * cost, and availability.
 */
export function searchRespiteProviders(
  criteria: RespiteSearchCriteria,
  providers: RespiteProvider[],
): RespiteMatchResult[] {
  const results: RespiteMatchResult[] = [];

  for (const provider of providers) {
    const distance = haversineDistance(criteria.location.lat, criteria.location.lng, provider.address.lat, provider.address.lng);

    if (distance > criteria.radiusMiles) continue;

    // Calculate match score
    let score = 50; // Base score
    const reasons: string[] = [];

    // Distance scoring (closer = better)
    const distanceScore = Math.max(0, 30 - (distance / criteria.radiusMiles) * 30);
    score += distanceScore;

    // Type match
    if (criteria.preferredType && criteria.preferredType.includes(provider.type)) {
      score += 15;
      reasons.push(`Matches preferred care type: ${provider.type}`);
    }

    // Specialization match
    const needMatches = criteria.careRecipientNeeds.filter(need =>
      provider.specializations.some(s => s.includes(need.toLowerCase()) || need.toLowerCase().includes(s)),
    );
    if (needMatches.length > 0) {
      score += needMatches.length * 10;
      reasons.push(`Specializes in: ${needMatches.join(', ')}`);
    }

    // Financial match
    if (criteria.requiresMedicaid && provider.acceptsMedicaid) {
      score += 10;
      reasons.push('Accepts Medicaid');
    }
    if (criteria.requiresMedicare && provider.acceptsMedicare) {
      score += 10;
      reasons.push('Accepts Medicare');
    }
    if (criteria.maxHourlyRate && provider.hourlyRate && provider.hourlyRate <= criteria.maxHourlyRate) {
      score += 5;
      reasons.push(`Within budget at $${provider.hourlyRate}/hr`);
    }

    // Availability match
    if (criteria.urgency === 'emergency' && provider.availability === 'immediate') {
      score += 20;
      reasons.push('Immediately available for emergency respite');
    } else if (criteria.urgency === 'this-week' && (provider.availability === 'immediate' || provider.availability === 'within-week')) {
      score += 10;
      reasons.push('Available within the week');
    }

    // Verified bonus
    if (provider.verified) {
      score += 5;
      reasons.push('Verified provider');
    }

    // Rating bonus
    if (provider.rating && provider.rating >= 4) {
      score += 5;
      reasons.push(`Rated ${provider.rating}/5`);
    }

    // Determine financial assistance
    const assistancePrograms = findEligiblePrograms(criteria, provider);

    results.push(RespiteMatchResultSchema.parse({
      provider,
      distanceMiles: Math.round(distance * 10) / 10,
      matchScore: Math.min(100, Math.round(score)),
      matchReasons: reasons,
      estimatedCost: {
        hourly: provider.hourlyRate,
        daily: provider.dailyRate,
        financialAssistanceAvailable: assistancePrograms.length > 0 || provider.slidingScale,
        assistancePrograms: assistancePrograms.map(p => p.name),
      },
    }));
  }

  return results.sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Find benefit programs the caregiver may be eligible for.
 */
export function findEligibleBenefitPrograms(
  caregiverProfile: { isVeteranCaregiver: boolean; careRecipientAge: number; isMedicaidEligible: boolean; state: string },
): BenefitProgram[] {
  const eligible: BenefitProgram[] = [];

  for (const program of BENEFIT_PROGRAMS) {
    if (program.id === 'va-caregiver' && caregiverProfile.isVeteranCaregiver) eligible.push(program);
    if (program.id === 'nfcsp' && caregiverProfile.careRecipientAge >= 60) eligible.push(program);
    if (program.id === 'medicaid-hcbs' && caregiverProfile.isMedicaidEligible) eligible.push(program);
    if (program.id === 'lifespan-respite') eligible.push(program); // Available to all
  }

  return eligible;
}

/**
 * Generate a respite care plan with scheduled breaks based on burnout risk.
 */
export function generateRespitePlan(
  burnoutRiskScore: number,
  weeklyHoursCaring: number,
  availableProviders: RespiteMatchResult[],
): {
  recommendedHoursPerWeek: number;
  schedule: Array<{ day: string; hours: number; providerSuggestion: string }>;
  estimatedMonthlyCost: number;
  costSavingOptions: string[];
} {
  // Higher risk = more respite needed
  const hoursNeeded = burnoutRiskScore < 30 ? 4 : burnoutRiskScore < 50 ? 8 : burnoutRiskScore < 75 ? 16 : 24;

  const topProvider = availableProviders[0];
  const hourlyRate = topProvider?.provider.hourlyRate || 20;

  const days = ['Monday', 'Wednesday', 'Friday', 'Saturday'];
  const hoursPerSession = Math.ceil(hoursNeeded / Math.min(days.length, Math.ceil(hoursNeeded / 4)));
  const schedule = days.slice(0, Math.ceil(hoursNeeded / hoursPerSession)).map(day => ({
    day,
    hours: hoursPerSession,
    providerSuggestion: topProvider?.provider.name || 'Search for local providers',
  }));

  return {
    recommendedHoursPerWeek: hoursNeeded,
    schedule,
    estimatedMonthlyCost: hoursNeeded * 4 * hourlyRate,
    costSavingOptions: [
      'Apply for National Family Caregiver Support Program through your local Area Agency on Aging',
      'Check Medicaid HCBS waiver eligibility in your state',
      'Contact local faith-based organizations for volunteer respite',
      'Explore adult day programs (often cheaper than in-home care)',
      'Ask family/friends to contribute specific scheduled hours',
    ],
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findEligiblePrograms(criteria: RespiteSearchCriteria, provider: RespiteProvider): BenefitProgram[] {
  const programs: BenefitProgram[] = [];
  if (criteria.requiresMedicaid && provider.acceptsMedicaid) {
    const hcbs = BENEFIT_PROGRAMS.find(p => p.id === 'medicaid-hcbs');
    if (hcbs) programs.push(hcbs);
  }
  programs.push(...BENEFIT_PROGRAMS.filter(p => p.id === 'nfcsp' || p.id === 'lifespan-respite'));
  return programs;
}
