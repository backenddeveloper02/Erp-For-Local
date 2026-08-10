import crypto from "crypto";
import AuditSession from "../model/auditSession.js";

const SESSION_TIMEOUT = 30; // minutes

// ======================================================
// CREATE SESSION
// ======================================================

export const createAuditSession = async ({ audit_id, user }) => {

    // Purani active session ko close kar do
    await AuditSession.update(
        {
            status: "completed",
            ended_at: new Date(),
        },
        {
            where: {
                audit_id,
                status: "active",
            },
        }
    );

    const token = crypto.randomUUID();

    const session = await AuditSession.create({

        audit_id,

        user_id: user.id,

        organization_id: user.organization_id,

        session_token: token,

        socket_room: `audit_session_${token}`,

        status: "active",

        started_at: new Date(),

        last_activity_at: new Date(),

        expires_at: new Date(
            Date.now() + SESSION_TIMEOUT * 60 * 1000
        ),

        device_info: "",

    });

    return session;
};

// ======================================================
// VALIDATE SESSION
// ======================================================

export const validateAuditSession = async (sessionToken) => {

    if (!sessionToken) {
        throw new Error("Audit Session Missing");
    }

    const session = await AuditSession.findOne({

        where: {

            session_token: sessionToken,

        },

    });

    if (!session) {
        throw new Error("Invalid Audit Session");
    }

    if (session.status !== "active") {
        throw new Error("Audit Session Closed");
    }

    if (new Date() > session.expires_at) {

        await session.update({

            status: "expired",

        });

        throw new Error("Audit Session Expired");

    }

    return session;

};

// ======================================================
// HEARTBEAT
// ======================================================

export const updateAuditHeartbeat = async (sessionToken) => {

    const session = await validateAuditSession(sessionToken);

    await session.update({

        last_activity_at: new Date(),

        expires_at: new Date(
            Date.now() + SESSION_TIMEOUT * 60 * 1000
        ),

    });

    return session;

};

// ======================================================
// COMPLETE SESSION
// ======================================================

export const completeAuditSession = async (sessionToken) => {

    const session = await validateAuditSession(sessionToken);

    await session.update({

        status: "completed",

        ended_at: new Date(),

    });

    return session;

};

// ======================================================
// GET CURRENT SESSION
// ======================================================

export const getCurrentAuditSession = async (userId) => {

    return AuditSession.findOne({

        where: {

            user_id: userId,

            status: "active",

        },

        order: [["started_at", "DESC"]],

    });

};

// ======================================================
// EXPIRE OLD SESSIONS
// ======================================================

export const expireAuditSessions = async () => {

    await AuditSession.update(

        {

            status: "expired",

        },

        {

            where: {

                status: "active",

                expires_at: {

                    [Op.lt]: new Date(),

                },

            },

        }

    );

};