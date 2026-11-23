import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQuizAnswerFeedbackFields1792700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE quiz_answers ADD COLUMN IF NOT EXISTS explanation TEXT`);
    await queryRunner.query(`ALTER TABLE quiz_answers ADD COLUMN IF NOT EXISTS "correctAnswer" TEXT`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE quiz_answers DROP COLUMN IF EXISTS explanation`);
    await queryRunner.query(`ALTER TABLE quiz_answers DROP COLUMN IF EXISTS "correctAnswer"`);
  }
}
