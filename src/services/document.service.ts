import { prisma } from '@/lib/prisma';

export class DocumentAttachmentService {
  /**
   * Attach a document to a specific business record.
   */
  static async attachDocument(organizationId: bigint, data: {
    record_type: string; // e.g. 'SUPPLIER', 'PRODUCT', 'PURCHASE_ORDER'
    record_id: string;
    file_name: string;
    file_url: string;
    file_type: string;
    file_size?: number;
    uploaded_by_id: bigint;
  }) {
    return prisma.documentAttachment.create({
      data: {
        organization_id: organizationId,
        record_type: data.record_type,
        record_id: data.record_id,
        file_name: data.file_name,
        file_url: data.file_url,
        file_type: data.file_type,
        file_size: data.file_size,
        uploaded_by_id: data.uploaded_by_id
      }
    });
  }

  /**
   * Fetch all documents attached to a specific record.
   */
  static async getAttachmentsForRecord(organizationId: bigint, recordType: string, recordId: string) {
    return prisma.documentAttachment.findMany({
      where: {
        organization_id: organizationId,
        record_type: recordType,
        record_id: recordId,
        is_deleted: false
      },
      orderBy: { created_at: 'desc' }
    });
  }

  /**
   * Soft delete a document attachment.
   */
  static async deleteAttachment(attachmentId: bigint, organizationId: bigint) {
    return prisma.documentAttachment.update({
      where: { id: attachmentId, organization_id: organizationId },
      data: { is_deleted: true }
    });
  }
}
