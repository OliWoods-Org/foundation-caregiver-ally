/**
 * Care Coordinator
 *
 * Manages medication schedules, appointments, insurance claims, and care
 * transitions for unpaid caregivers. Centralizes all care coordination
 * tasks in one place with reminders and conflict detection.
 *
 * @module care-coordinator
 * @license GPL-3.0
 * @author OliWoods Foundation
 */

import { z } from 'zod';

// ── Schemas ──────────────────────────────────────────────────────────────────

export const MedicationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  dosage: z.string(),
  frequency: z.string(),
  route: z.enum(['oral', 'injection', 'topical', 'inhaled', 'sublingual', 'rectal', 'patch']),
  prescriber: z.string(),
  pharmacy: z.string().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  refillDate: z.string().datetime().optional(),
  instructions: z.string().optional(),
  sideEffects: z.array(z.string()).default([]),
  interactions: z.array(z.string()).default([]),
  isControlled: z.boolean().default(false),
});

export const MedicationScheduleSchema = z.object({
  medicationId: z.string().uuid(),
  medicationName: z.string(),
  scheduledTimes: z.array(z.object({
    time: z.string(),
    withFood: z.boolean(),
    notes: z.string().optional(),
  })),
  missedDoses: z.number().int().nonnegative().default(0),
  adherenceRate: z.number().min(0).max(100),
});

export const AppointmentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  provider: z.string(),
  specialty: z.string(),
  location: z.string(),
  dateTime: z.string().datetime(),
  durationMinutes: z.number().int().positive(),
  type: z.enum(['in-person', 'telehealth', 'phone', 'lab-work', 'imaging', 'procedure']),
  prepInstructions: z.string().optional(),
  questionsToAsk: z.array(z.string()).default([]),
  transportNeeded: z.boolean().default(false),
  notes: z.string().optional(),
  status: z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'rescheduled']),
});

export const CareTransitionSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['hospital-to-home', 'home-to-facility', 'facility-to-home', 'icu-to-floor', 'er-discharge']),
  fromLocation: z.string(),
  toLocation: z.string(),
  date: z.string().datetime(),
  dischargeSummary: z.string().optional(),
  newMedications: z.array(z.string()),
  discontinuedMedications: z.array(z.string()),
  followUpAppointments: z.array(z.string()),
  homeEquipmentNeeded: z.array(z.string()),
  warningSignsToWatch: z.array(z.string()),
  emergencyPlan: z.string(),
});

export const DailyCarePlanSchema = z.object({
  date: z.string(),
  careRecipientName: z.string(),
  medications: z.array(MedicationScheduleSchema),
  appointments: z.array(AppointmentSchema),
  tasks: z.array(z.object({
    time: z.string(),
    task: z.string(),
    category: z.enum(['medication', 'meal', 'hygiene', 'exercise', 'therapy', 'medical', 'social', 'other']),
    completed: z.boolean(),
  })),
  notes: z.string().optional(),
  conflicts: z.array(z.string()),
});

// ── Types ────────────────────────────────────────────────────────────────────

export type Medication = z.infer<typeof MedicationSchema>;
export type MedicationSchedule = z.infer<typeof MedicationScheduleSchema>;
export type Appointment = z.infer<typeof AppointmentSchema>;
export type CareTransition = z.infer<typeof CareTransitionSchema>;
export type DailyCarePlan = z.infer<typeof DailyCarePlanSchema>;

// ── Functions ────────────────────────────────────────────────────────────────

/**
 * Generate a daily care plan from medications, appointments, and routine tasks.
 * Detects scheduling conflicts and medication interaction warnings.
 */
export function generateDailyCarePlan(
  date: string,
  careRecipientName: string,
  medications: Medication[],
  appointments: Appointment[],
  routineTasks: Array<{ time: string; task: string; category: string }>,
): DailyCarePlan {
  const conflicts: string[] = [];

  // Build medication schedules
  const medSchedules: MedicationSchedule[] = medications
    .filter(m => {
      const start = new Date(m.startDate);
      const end = m.endDate ? new Date(m.endDate) : null;
      const planDate = new Date(date);
      return planDate >= start && (!end || planDate <= end);
    })
    .map(m => ({
      medicationId: m.id,
      medicationName: m.name,
      scheduledTimes: parseFrequencyToTimes(m.frequency, m.instructions),
      missedDoses: 0,
      adherenceRate: 100,
    }));

  // Check medication interactions
  for (let i = 0; i < medications.length; i++) {
    for (let j = i + 1; j < medications.length; j++) {
      const interactions = checkMedicationInteractions(medications[i], medications[j]);
      conflicts.push(...interactions);
    }
  }

  // Filter appointments for this date
  const dayAppointments = appointments.filter(a => a.dateTime.startsWith(date) && a.status !== 'cancelled');

  // Check appointment conflicts
  for (let i = 0; i < dayAppointments.length; i++) {
    for (let j = i + 1; j < dayAppointments.length; j++) {
      const overlap = checkAppointmentOverlap(dayAppointments[i], dayAppointments[j]);
      if (overlap) conflicts.push(overlap);
    }
  }

  // Build task list
  const allTasks = [
    ...medSchedules.flatMap(ms => ms.scheduledTimes.map(st => ({
      time: st.time,
      task: `Give ${ms.medicationName}${st.withFood ? ' (with food)' : ''}${st.notes ? ` — ${st.notes}` : ''}`,
      category: 'medication' as const,
      completed: false,
    }))),
    ...dayAppointments.map(a => ({
      time: a.dateTime.split('T')[1]?.substring(0, 5) || '09:00',
      task: `${a.type === 'telehealth' ? 'Telehealth' : 'Appointment'}: ${a.title} with ${a.provider}${a.transportNeeded ? ' (transport needed)' : ''}`,
      category: 'medical' as const,
      completed: false,
    })),
    ...routineTasks.map(t => ({ ...t, category: t.category as any, completed: false })),
  ].sort((a, b) => a.time.localeCompare(b.time));

  return DailyCarePlanSchema.parse({
    date,
    careRecipientName,
    medications: medSchedules,
    appointments: dayAppointments,
    tasks: allTasks,
    conflicts,
  });
}

/**
 * Create a care transition checklist when moving between care settings.
 * Ensures nothing falls through the cracks during dangerous handoff periods.
 */
export function createCareTransitionPlan(
  transition: CareTransition,
  currentMedications: Medication[],
): {
  checklist: Array<{ item: string; category: string; critical: boolean; completed: boolean }>;
  medicationReconciliation: Array<{ medication: string; status: string; action: string }>;
  followUpTimeline: Array<{ timeframe: string; action: string }>;
} {
  const checklist: Array<{ item: string; category: string; critical: boolean; completed: boolean }> = [
    { item: 'Obtain complete discharge summary', category: 'documentation', critical: true, completed: false },
    { item: 'Review and reconcile all medications', category: 'medication', critical: true, completed: false },
    { item: 'Schedule all follow-up appointments', category: 'appointments', critical: true, completed: false },
    { item: 'Fill new prescriptions at pharmacy', category: 'medication', critical: true, completed: false },
    { item: 'Set up home medical equipment', category: 'equipment', critical: transition.homeEquipmentNeeded.length > 0, completed: false },
    { item: 'Understand warning signs requiring emergency return', category: 'safety', critical: true, completed: false },
    { item: 'Confirm insurance coverage for new services', category: 'insurance', critical: false, completed: false },
    { item: 'Update all providers on transition', category: 'communication', critical: false, completed: false },
  ];

  // Add equipment-specific items
  for (const equipment of transition.homeEquipmentNeeded) {
    checklist.push({ item: `Set up and test: ${equipment}`, category: 'equipment', critical: true, completed: false });
  }

  // Medication reconciliation
  const medReconciliation = currentMedications.map(med => {
    const isDiscontinued = transition.discontinuedMedications.some(d => d.toLowerCase() === med.name.toLowerCase());
    const isNew = transition.newMedications.some(n => n.toLowerCase() === med.name.toLowerCase());
    return {
      medication: med.name,
      status: isDiscontinued ? 'DISCONTINUED' : isNew ? 'NEW' : 'CONTINUE',
      action: isDiscontinued ? `Stop ${med.name}. Dispose safely.` : isNew ? `Start ${med.name} as prescribed.` : `Continue ${med.name} at current dose.`,
    };
  });

  // Add new medications not in current list
  for (const newMed of transition.newMedications) {
    if (!currentMedications.some(m => m.name.toLowerCase() === newMed.toLowerCase())) {
      medReconciliation.push({ medication: newMed, status: 'NEW', action: `Fill and start ${newMed} as prescribed.` });
    }
  }

  return {
    checklist,
    medicationReconciliation: medReconciliation,
    followUpTimeline: [
      { timeframe: 'Within 24 hours', action: 'Fill all new prescriptions; set up medication schedule' },
      { timeframe: 'Within 48 hours', action: 'Primary care physician follow-up call or visit' },
      { timeframe: 'Within 7 days', action: 'First follow-up appointment with discharging provider' },
      { timeframe: 'Within 30 days', action: 'Complete all scheduled follow-up appointments' },
    ],
  };
}

/**
 * Check medication adherence over a time period and generate a report.
 */
export function calculateAdherenceReport(
  medications: Medication[],
  doseRecords: Array<{ medicationId: string; scheduledTime: string; takenTime: string | null; skipped: boolean }>,
): {
  overallAdherence: number;
  byMedication: Array<{ name: string; adherence: number; missedDoses: number; lateDoses: number }>;
  concerns: string[];
} {
  const byMed = new Map<string, { total: number; taken: number; late: number; missed: number }>();

  for (const med of medications) {
    byMed.set(med.id, { total: 0, taken: 0, late: 0, missed: 0 });
  }

  for (const record of doseRecords) {
    const stats = byMed.get(record.medicationId);
    if (!stats) continue;
    stats.total++;
    if (record.skipped || !record.takenTime) {
      stats.missed++;
    } else {
      stats.taken++;
      const scheduled = new Date(record.scheduledTime).getTime();
      const taken = new Date(record.takenTime).getTime();
      if (Math.abs(taken - scheduled) > 60 * 60 * 1000) stats.late++; // > 1 hour late
    }
  }

  const concerns: string[] = [];
  const byMedReport = medications.map(m => {
    const stats = byMed.get(m.id) || { total: 0, taken: 0, late: 0, missed: 0 };
    const adherence = stats.total > 0 ? Math.round((stats.taken / stats.total) * 100) : 100;
    if (adherence < 80) concerns.push(`${m.name} adherence is ${adherence}% — below 80% threshold. Discuss with prescriber.`);
    if (m.isControlled && stats.missed > 0) concerns.push(`${m.name} (controlled substance) has ${stats.missed} missed doses — verify with prescriber.`);
    return { name: m.name, adherence, missedDoses: stats.missed, lateDoses: stats.late };
  });

  const totalDoses = doseRecords.length;
  const takenDoses = doseRecords.filter(r => !r.skipped && r.takenTime).length;
  const overallAdherence = totalDoses > 0 ? Math.round((takenDoses / totalDoses) * 100) : 100;

  return { overallAdherence, byMedication: byMedReport, concerns };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseFrequencyToTimes(frequency: string, instructions?: string | null): Array<{ time: string; withFood: boolean; notes?: string }> {
  const lower = frequency.toLowerCase();
  const withFood = (instructions || '').toLowerCase().includes('with food');

  if (lower.includes('once daily') || lower === 'qd') return [{ time: '08:00', withFood }];
  if (lower.includes('twice daily') || lower === 'bid') return [{ time: '08:00', withFood }, { time: '20:00', withFood }];
  if (lower.includes('three times') || lower === 'tid') return [{ time: '08:00', withFood }, { time: '14:00', withFood }, { time: '20:00', withFood }];
  if (lower.includes('four times') || lower === 'qid') return [{ time: '08:00', withFood }, { time: '12:00', withFood }, { time: '17:00', withFood }, { time: '22:00', withFood }];
  if (lower.includes('bedtime') || lower === 'qhs') return [{ time: '22:00', withFood: false }];
  if (lower.includes('morning')) return [{ time: '08:00', withFood }];

  return [{ time: '08:00', withFood, notes: `Frequency: ${frequency}` }];
}

function checkMedicationInteractions(med1: Medication, med2: Medication): string[] {
  const warnings: string[] = [];
  for (const interaction of med1.interactions) {
    if (interaction.toLowerCase().includes(med2.name.toLowerCase())) {
      warnings.push(`WARNING: ${med1.name} has a known interaction with ${med2.name}: ${interaction}`);
    }
  }
  for (const interaction of med2.interactions) {
    if (interaction.toLowerCase().includes(med1.name.toLowerCase())) {
      warnings.push(`WARNING: ${med2.name} has a known interaction with ${med1.name}: ${interaction}`);
    }
  }
  return warnings;
}

function checkAppointmentOverlap(a1: Appointment, a2: Appointment): string | null {
  const start1 = new Date(a1.dateTime).getTime();
  const end1 = start1 + a1.durationMinutes * 60000;
  const start2 = new Date(a2.dateTime).getTime();
  const end2 = start2 + a2.durationMinutes * 60000;

  if (start1 < end2 && start2 < end1) {
    return `CONFLICT: "${a1.title}" overlaps with "${a2.title}" — reschedule one of these appointments`;
  }
  return null;
}
