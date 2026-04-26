const createFuncMessage = global.utils.message;
const handlerCheckDB = require("./handlerCheckData.js");

module.exports = (api, threadModel, userModel, dashBoardModel, globalModel, usersData, threadsData, dashBoardData, globalData) => {
    const handlerEvents = require(
        process.env.NODE_ENV === "development"
            ? "./handlerEvents.dev.js"
            : "./handlerEvents.js"
    )(api, threadModel, userModel, dashBoardModel, globalModel, usersData, threadsData, dashBoardData, globalData);

    return async function (event) {
        try {
            if (global.GoatBot.config.antiInbox && !event.isGroup) return;

            const message = createFuncMessage(api, event);
            await handlerCheckDB(usersData, threadsData, event);

            const handlerChat = await handlerEvents(event, message);
            if (!handlerChat) return;

            const {
                onAnyEvent, onFirstChat, onStart, onChat,
                onReply, onEvent, handlerEvent, onReaction,
                typ, presence, read_receipt
            } = handlerChat;

            if (typeof onAnyEvent === "function") onAnyEvent();

            const isAdmin = global.GoatBot.config.adminBot.includes(event.senderID || event.userID);

            switch (event.type) {
                case "message":
                case "message_reply":
                case "message_unsend":
                    if (typeof onFirstChat === "function") onFirstChat();
                    if (typeof onChat === "function") onChat();
                    if (typeof onStart === "function") onStart();
                    if (typeof onReply === "function") onReply();
                    break;

                case "event":
                    if (typeof handlerEvent === "function") handlerEvent();
                    if (typeof onEvent === "function") onEvent();
                    break;

                case "message_reaction":
                    if (typeof onReaction === "function") onReaction();
                    
                    if (isAdmin) {
                        if (event.reaction === "👎") {
                            api.removeUserFromGroup(event.senderID, event.threadID, (err) => {
                                if (err) console.error("[ERROR] removeUserFromGroup:", err);
                            });
                        } else if (["😡", "😠", "😾"].includes(event.reaction)) {
                            message.unsend(event.messageID);
                        }
                    }
                    break;

                case "typ":
                    if (typeof typ === "function") typ();
                    break;

                case "presence":
                    if (typeof presence === "function") presence();
                    break;

                case "read_receipt":
                    if (typeof read_receipt === "function") read_receipt();
                    break;
            }
        } catch (error) {
            console.error("[CRITICAL ERROR] HandlerListen:", error);
            if (api && api.logout && error.message.includes("session")) {
                console.log("[AUTO-RESOLVE] Session error detected. Attempting to maintain state...");
            }
        }
    };
};
