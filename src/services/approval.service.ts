import { prisma } from '@/lib/prisma';
import { ApprovalStatus } from '@prisma/client';

export class ApprovalService {
  /**
   * Request an approval for an action.
   */
  static async requestApproval(organizationId: bigint, data: {
    workflow_id: bigint;
    requester_id: bigint;
    record_id: string;
    record_type: string;
    comments?: string;
    steps: { approver_id: bigint; step_level: number }[];
  }) {
    return prisma.approvalRequest.create({
      data: {
        workflow_id: data.workflow_id,
        requester_id: data.requester_id,
        record_id: data.record_id,
        record_type: data.record_type,
        status: 'PENDING',
        comments: data.comments,
        steps: {
          create: data.steps.map(step => ({
            approver_id: step.approver_id,
            step_level: step.step_level,
            status: 'PENDING'
          }))
        }
      },
      include: { steps: true }
    });
  }

  /**
   * Process an approval step (Approve/Reject).
   */
  static async processApprovalStep(organizationId: bigint, data: {
    request_id: bigint;
    approver_id: bigint;
    status: 'APPROVED' | 'REJECTED';
    comments?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const request = await tx.approvalRequest.findUnique({
        where: { id: data.request_id },
        include: { steps: { orderBy: { step_level: 'asc' } } }
      });

      if (!request) throw new Error('Approval request not found');
      if (request.status !== 'PENDING') throw new Error(`Approval request is already ${request.status}`);

      // Find the step for this approver
      const currentStep = request.steps.find(s => s.status === 'PENDING' && s.approver_id === data.approver_id);
      if (!currentStep) {
        throw new Error('You are not authorized to approve this step or it is already processed.');
      }

      // Ensure previous steps are approved
      const previousSteps = request.steps.filter(s => s.step_level < currentStep.step_level);
      if (previousSteps.some(s => s.status !== 'APPROVED')) {
        throw new Error('Previous approval steps have not been completed yet.');
      }

      // Update the step
      await tx.approvalStep.update({
        where: { id: currentStep.id },
        data: { 
          status: data.status, 
          comments: data.comments, 
          processed_at: new Date() 
        }
      });

      // Check overall workflow status
      let requestStatus: ApprovalStatus = 'PENDING';

      if (data.status === 'REJECTED') {
        // If any step rejects, the entire request is rejected
        requestStatus = 'REJECTED';
      } else {
        // Check if all steps are approved
        const remainingSteps = request.steps.filter(s => s.status === 'PENDING' && s.id !== currentStep.id);
        if (remainingSteps.length === 0) {
          requestStatus = 'APPROVED';
        }
      }

      if (requestStatus !== 'PENDING') {
        await tx.approvalRequest.update({
          where: { id: request.id },
          data: { status: requestStatus, updated_at: new Date() }
        });
      }

      return { request_id: request.id, status: requestStatus };
    });
  }
}
