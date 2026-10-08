"""a006 coding questions + judge queue

Revision ID: a006
Revises: a005
"""
from alembic import op
import sqlalchemy as sa

revision = 'a006'
down_revision = 'a005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('questions', sa.Column('coding', sa.JSON(), nullable=True))
    op.create_table('coding_tests',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('question_id', sa.String(length=36), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('input_text', sa.Text(), nullable=False),
        sa.Column('output_text', sa.Text(), nullable=False),
        sa.Column('is_sample', sa.Boolean(), nullable=False),
        sa.Column('weight', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['question_id'], ['questions.id'], name=op.f('fk_coding_tests_question_id_questions'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_coding_tests')),
        sa.UniqueConstraint('question_id', 'position', name='uq_coding_tests_question_position'),
    )
    op.create_index(op.f('ix_coding_tests_question_id'), 'coding_tests', ['question_id'], unique=False)
    op.create_table('code_submissions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('attempt_id', sa.String(length=36), nullable=False),
        sa.Column('question_id', sa.String(length=36), nullable=False),
        sa.Column('student_id', sa.String(length=36), nullable=False),
        sa.Column('language', sa.String(length=16), nullable=False),
        sa.Column('mode', sa.String(length=8), nullable=False),
        sa.Column('source', sa.Text(), nullable=False),
        sa.Column('source_sha256', sa.String(length=64), nullable=False),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('verdict', sa.String(length=8), nullable=True),
        sa.Column('passed', sa.Integer(), nullable=False),
        sa.Column('total', sa.Integer(), nullable=False),
        sa.Column('score', sa.Numeric(precision=8, scale=2), nullable=False),
        sa.Column('max_score', sa.Numeric(precision=8, scale=2), nullable=False),
        sa.Column('time_ms', sa.Integer(), nullable=True),
        sa.Column('memory_kb', sa.Integer(), nullable=True),
        sa.Column('failed_test', sa.Integer(), nullable=True),
        sa.Column('compile_output', sa.Text(), nullable=True),
        sa.Column('test_results', sa.JSON(), nullable=False),
        sa.Column('priority', sa.Integer(), nullable=False),
        sa.Column('tries', sa.Integer(), nullable=False),
        sa.Column('judge_id', sa.String(length=64), nullable=True),
        sa.Column('lease_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('queued_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['attempt_id'], ['exam_attempts.id'], name=op.f('fk_code_submissions_attempt_id_exam_attempts')),
        sa.ForeignKeyConstraint(['question_id'], ['questions.id'], name=op.f('fk_code_submissions_question_id_questions')),
        sa.ForeignKeyConstraint(['student_id'], ['users.id'], name=op.f('fk_code_submissions_student_id_users')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_code_submissions')),
    )
    op.create_index('ix_code_submissions_queue', 'code_submissions', ['status', 'priority', 'queued_at'], unique=False)
    op.create_index('ix_code_submissions_attempt_question', 'code_submissions', ['attempt_id', 'question_id', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_code_submissions_attempt_question', table_name='code_submissions')
    op.drop_index('ix_code_submissions_queue', table_name='code_submissions')
    op.drop_table('code_submissions')
    op.drop_index(op.f('ix_coding_tests_question_id'), table_name='coding_tests')
    op.drop_table('coding_tests')
    op.drop_column('questions', 'coding')
