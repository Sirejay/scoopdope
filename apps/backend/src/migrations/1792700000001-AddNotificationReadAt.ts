import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationReadAt1792700000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMPTZ`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE notifications DROP COLUMN IF EXISTS "readAt"`,
    );
  }
}
