const { db, utils, GoatBot } = global;
const { config } = GoatBot;
const { log } = utils;
const { creatingThreadData, creatingUserData } = global.client.database;

module.exports = async function (usersData, threadsData, event) {
    const threadID = event.threadID;
    const senderID = event.senderID || event.author || event.userID;

    if (!threadID && !senderID) return;

    try {
        if (threadID && !global.temp.createThreadDataError.includes(threadID)) {
            const threadInQueue = creatingThreadData.find(t => t.threadID == threadID);
            
            if (!threadInQueue) {
                if (!db.allThreadData.some(t => t.threadID == threadID)) {
                    try {
                        const threadData = await threadsData.create(threadID);
                        if (threadData) {
                            log.info("DATABASE", `[THREAD] Created: ${threadID} | ${config.database.type}`);
                        }
                    } catch (err) {
                        if (err.name !== "DATA_ALREADY_EXISTS") {
                            global.temp.createThreadDataError.push(threadID);
                            log.err("DATABASE", `Thread Error: ${threadID}`, err);
                        }
                    }
                }
            } else {
                await threadInQueue.promise;
            }
        }

        if (senderID && !global.client.allIDsBlockedAndIgnored?.includes(senderID)) {
            const userInQueue = creatingUserData.find(u => u.userID == senderID);
            
            if (!userInQueue) {
                if (!db.allUserData.some(u => u.userID == senderID)) {
                    try {
                        const userData = await usersData.create(senderID);
                        if (userData) {
                            log.info("DATABASE", `[USER] Created: ${senderID} | ${config.database.type}`);
                        }
                    } catch (err) {
                        if (err.name !== "DATA_ALREADY_EXISTS") {
                            log.err("DATABASE", `User Error: ${senderID}`, err);
                        }
                    }
                }
            } else {
                await userInQueue.promise;
            }
        }
    } catch (criticalErr) {
        log.err("DB_SYNC_ERROR", criticalErr);
    }
};
