/**
 * Grade math. The current class grade is points-based: the sum of points earned
 * across graded assignments divided by the sum of points possible. This matches
 * the requirement that grades auto-calculate from assignment point values.
 * (Weighted-by-category roll-ups using classes.grading_scheme can layer on later.)
 */

/** Map a 0–100 percentage to a letter grade (standard US scale with +/-). */
export function letterGrade(percentage) {
  if (percentage == null) return null;
  if (percentage >= 97) return 'A+';
  if (percentage >= 93) return 'A';
  if (percentage >= 90) return 'A-';
  if (percentage >= 87) return 'B+';
  if (percentage >= 83) return 'B';
  if (percentage >= 80) return 'B-';
  if (percentage >= 77) return 'C+';
  if (percentage >= 73) return 'C';
  if (percentage >= 70) return 'C-';
  if (percentage >= 67) return 'D+';
  if (percentage >= 63) return 'D';
  if (percentage >= 60) return 'D-';
  return 'F';
}

/**
 * Build a grade summary from raw point totals.
 * @param {number} pointsEarned
 * @param {number} pointsPossible
 * @param {number} gradedCount  number of graded assignments
 */
export function summarizeGrade(pointsEarned, pointsPossible, gradedCount) {
  const percentage =
    pointsPossible > 0
      ? Math.round((pointsEarned / pointsPossible) * 1000) / 10 // 1 decimal place
      : null;
  return {
    pointsEarned,
    pointsPossible,
    percentage,
    letter: letterGrade(percentage),
    gradedAssignments: gradedCount,
  };
}
