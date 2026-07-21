// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { SupportService } from '@/services/support.service';
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils';
import { prisma } from '@/lib/prisma';
import { EmailService } from '@/services/email.service';

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers);
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    let decoded: any;
    try {
      decoded = verifyBearerToken(req.headers);
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 });
    }

    const organizationId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined;
    const isSuperAdmin = Number(decoded.role_id) === 9 || decoded.role === 'super_admin';

    // If super admin, they can see all tickets (or organizationId = undefined in SupportService)
    const tickets = isSuperAdmin 
      ? await SupportService.getAllTickets() 
      : (organizationId ? await SupportService.getTickets(organizationId) : []);

    const serializedTickets = tickets.map((t: any) => ({
      ...t,
      id: t.id.toString(),
      organization_id: t.organization_id.toString(),
      assigned_to_id: t.assigned_to_id?.toString(),
      created_by_id: t.created_by_id.toString(),
      User_SupportTicket_created_by_idToUser: t.User_SupportTicket_created_by_idToUser ? {
        ...t.User_SupportTicket_created_by_idToUser,
        id: t.User_SupportTicket_created_by_idToUser.id.toString()
      } : null,
      User_SupportTicket_assigned_to_idToUser: t.User_SupportTicket_assigned_to_idToUser ? {
        ...t.User_SupportTicket_assigned_to_idToUser,
        id: t.User_SupportTicket_assigned_to_idToUser.id.toString()
      } : null
    }));

    return NextResponse.json({ success: true, data: serializedTickets });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers);
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    let decoded: any;
    try {
      decoded = verifyBearerToken(req.headers);
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 });
    }

    const organizationId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined;
    if (!organizationId) {
      return NextResponse.json({ success: false, error: 'Forbidden: No organization assigned' }, { status: 403 });
    }

    const adminId = BigInt(decoded.id);
    const body = await req.json();
    const { subject, category, priority, message, assignedToId } = body;

    if (!subject || !priority || !message) {
      return NextResponse.json({ success: false, error: 'Missing required fields: subject, priority, message' }, { status: 400 });
    }

    const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
    if (!validPriorities.includes(priority)) {
      return NextResponse.json({ success: false, error: `Invalid priority. Must be one of: ${validPriorities.join(', ')}` }, { status: 400 });
    }

    const newTicket = await SupportService.createTicket(
      organizationId,
      adminId,
      {
        subject,
        category,
        priority,
        message,
        status: 'SUBMITTED',
        assigned_to_id: assignedToId ? BigInt(assignedToId) : undefined
      }
    );

    const serializedTicket = {
      ...newTicket,
      id: newTicket.id.toString(),
      organization_id: newTicket.organization_id.toString(),
      assigned_to_id: newTicket.assigned_to_id?.toString(),
      created_by_id: newTicket.created_by_id.toString(),
      User_SupportTicket_created_by_idToUser: newTicket.User_SupportTicket_created_by_idToUser ? {
        ...newTicket.User_SupportTicket_created_by_idToUser,
        id: newTicket.User_SupportTicket_created_by_idToUser.id.toString()
      } : null,
      User_SupportTicket_assigned_to_idToUser: newTicket.User_SupportTicket_assigned_to_idToUser ? {
        ...newTicket.User_SupportTicket_assigned_to_idToUser,
        id: newTicket.User_SupportTicket_assigned_to_idToUser.id.toString()
      } : null
    };

    // Dispatch emails asynchronously
    (async () => {
      try {
        const adminEmail = newTicket.User_SupportTicket_created_by_idToUser?.email;
        const adminName = `${newTicket.User_SupportTicket_created_by_idToUser?.first_name || ''} ${newTicket.User_SupportTicket_created_by_idToUser?.last_name || ''}`.trim();
        
        // Get organization name
        const org = await prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true }
        });
        const orgName = org?.name || 'Unknown Organization';

        // Get Super Admins (role_id 9 or role name 'super_admin')
        const superAdmins = await prisma.user.findMany({
          where: {
            OR: [
              { role_id: 9 },
              { role: { name: 'super_admin' } }
            ]
          },
          select: { email: true }
        });
        const superAdminEmails = superAdmins.map((u: any) => u.email).filter(Boolean);

        // 1. Send confirmation to the Administrator
        if (adminEmail) {
          await EmailService.sendSupportTicketCreatedToAdmin(
            adminEmail,
            adminName || 'Admin',
            subject,
            newTicket.id.toString()
          );
        }

        // 2. Send notification to Super Admins
        if (superAdminEmails.length > 0) {
          await EmailService.sendSupportTicketCreatedToSuperAdmin(
            superAdminEmails,
            orgName,
            adminName || 'Admin',
            subject,
            priority,
            newTicket.id.toString()
          );
        }
      } catch (emailError) {
        console.error('[Support Email Error] Failed to send ticket creation emails:', emailError);
      }
    })();

    return NextResponse.json({ success: true, message: 'Support ticket created successfully', data: serializedTicket }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers);
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    let decoded: any;
    try {
      decoded = verifyBearerToken(req.headers);
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing ticket ID' }, { status: 400 });
    }

    const isSuperAdmin = Number(decoded.role_id) === 9 || decoded.role === 'super_admin';
    const organizationId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined;

    if (!isSuperAdmin && !organizationId) {
      return NextResponse.json({ success: false, error: 'Forbidden: No organization assigned' }, { status: 403 });
    }

    const body = await req.json();
    const { status, priority, responseMessage } = body;

    // Use SupportService to update ticket
    const updatedTicket = await SupportService.updateTicket(
      BigInt(id),
      {
        status,
        priority,
        response_message: responseMessage
      },
      isSuperAdmin ? undefined : organizationId // To ensure org admins only update their org's tickets
    );

    // If status or response message changed, send email to ticket creator
    if (status || responseMessage) {
      (async () => {
        try {
          const ticketWithCreator = await prisma.supportTicket.findUnique({
            where: { id: BigInt(id) },
            include: {
              User_SupportTicket_created_by_idToUser: {
                select: { email: true, first_name: true, last_name: true }
              }
            }
          });

          const creator = ticketWithCreator?.User_SupportTicket_created_by_idToUser;
          if (creator && creator.email) {
            const adminName = `${creator.first_name || ''} ${creator.last_name || ''}`.trim() || 'Admin';
            await EmailService.sendSupportTicketReplyToAdmin(
              creator.email,
              adminName,
              ticketWithCreator.subject,
              updatedTicket.response_message || '',
              updatedTicket.status,
              updatedTicket.id.toString(),
              ticketWithCreator.message || ''
            );
          }
        } catch (emailError) {
          console.error('[Support Email Error] Failed to send ticket reply email:', emailError);
        }
      })();
    }

    return NextResponse.json({ success: true, message: 'Support ticket updated successfully', data: updatedTicket });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 400 });
  }
}
