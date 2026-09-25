import { Injectable, type OnModuleInit } from '@nestjs/common';
import { IntegrityCheckRegistry } from '../common/integrity/integrity-check.registry';
import {
  MlsAuditRepository,
  type StuckParticipant,
  type SuspectLeaf,
} from './mls-audit.repository';

const leafLine = (leaf: SuspectLeaf) =>
  `${leaf.conversationId} / ${leaf.userId} / ${leaf.deviceId}`;
const stuckLine = (row: StuckParticipant) =>
  `${row.conversationId} / ${row.userId} (${row.state})`;

/**
 * The MLS domain's data invariants, registered with the shared integrity
 * sweep. Each states something prevention and self-healing should make
 * impossible to see persist - a violation means both failed silently.
 */
@Injectable()
export class MlsIntegrityChecks implements OnModuleInit {
  constructor(
    private readonly registry: IntegrityCheckRegistry,
    private readonly auditRepository: MlsAuditRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      {
        name: 'mls-dead-device-leaf',
        title: 'A retired or deleted device is still in a group encryption',
        source: 'mls',
        findViolations: async () =>
          (await this.auditRepository.findLeavesOfDeadDevices()).map(leafLine),
      },
      {
        name: 'mls-outsider-leaf',
        title:
          'A device is in a group encryption although its owner is not in the conversation',
        source: 'mls',
        findViolations: async () =>
          (await this.auditRepository.findLeavesOfOutsiders()).map(leafLine),
      },
      {
        name: 'mls-stuck-membership',
        title: 'Joins or removals stuck past their self-healing window',
        source: 'mls',
        findViolations: async () =>
          (await this.auditRepository.findStuckParticipants()).map(stuckLine),
      },
    );
  }
}
