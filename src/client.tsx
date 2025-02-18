// should handle all of the complexities of dealing with the skychat server and lib, handle saving and loading state, etc.

import { v4 as uuidv4 } from 'uuid';
import { ConvoManager } from './index';

// Type definitions
type GroupId = Uint8Array;
type SerializedMessage = Uint8Array;

interface MessageItem {
  text: string;
  senderId: string;
  timestamp: number;
}

interface ConvoGroup {
  name: string;
  globalIndex: number;
  decrypted: MessageItem[];
}

interface ConvoUser {
  userId: string;
  name: string;
}

interface ConvoInvite {
  groupName: string;
  welcomeMessage: Uint8Array;
  ratchetTree: Uint8Array;
  fanned: Uint8Array;
}

interface ConvoMessage {
  senderId: string;
  message: SerializedMessage;
  globalIndex: number;
}

export class ConvoClient {
  public name: string;
  public userId: string;
  private manager: ConvoManager;
  private serverAddress: string | null;
  private idToName: Map<string, string>;

  constructor(name: string) {
    this.name = name;
    this.userId = uuidv4();
    this.manager = new ConvoManager(name);
    this.serverAddress = null;
    this.idToName = new Map();
  }

  async createGroup(groupName: string): Promise<void> {
    if (!this.serverAddress) {
      throw new Error("Server address is not set");
    }

    const groupId = this.manager.createNewGroup(groupName);

    const response = await fetch(`${this.serverAddress}/api/create_group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        group_id: Array.from(groupId),
        group_name: groupName,
        sender_id: this.userId
      })
    });

    if (response.ok) {
      const group = this.manager.groups.get(Buffer.from(groupId).toString('hex'));
      if (group) {
        group.decrypted.push({
          text: "<group_created>",
          senderId: "system",
          timestamp: Date.now()
        });
      }
    }
  }

  async connectToServer(serverAddress: string): Promise<void> {
    this.serverAddress = serverAddress;

    const response = await fetch(`${serverAddress}/api/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: this.name,
        user_id: this.userId,
        serialized_key_package: Array.from(this.manager.getKeyPackage())
      })
    });

    if (!response.ok) {
      throw new Error("Failed to connect to server");
    }
  }

  async listUsers(): Promise<ConvoUser[]> {
    if (!this.serverAddress) {
      throw new Error("Server address is not set");
    }

    const response = await fetch(`${this.serverAddress}/api/list_users`);
    const users: ConvoUser[] = await response.json();

    users.forEach(user => {
      this.idToName.set(user.userId, user.name);
    });
    this.idToName.set("system", "system");

    return users;
  }

  async inviteUserToGroup(
    receiverId: string,
    groupId: GroupId,
    serializedKeyPackage: Uint8Array
  ): Promise<void> {
    if (!this.serverAddress) {
      throw new Error("Server address is not set");
    }

    const groupInvite = this.manager.createInvite(groupId, serializedKeyPackage);

    const response = await fetch(`${this.serverAddress}/api/invite_user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        group_id: Array.from(groupId),
        sender_id: this.userId,
        receiver_id: receiverId,
        welcome_message: Array.from(groupInvite.welcomeMessage),
        ratchet_tree: Array.from(groupInvite.ratchetTree),
        fanned: Array.from(groupInvite.fanned)
      })
    });

    if (!response.ok) {
      throw new Error("Failed to send invite");
    }
  }

  async processInvite(invite: ConvoInvite): Promise<void> {
    this.manager.processInvite(invite);

    if (!this.serverAddress) {
      throw new Error("Server address is not set");
    }

    const groupId = Array.from(this.findGroupIdByName(invite.groupName));

    const response = await fetch(`${this.serverAddress}/api/accept_invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        group_id: groupId,
        sender_id: this.userId
      })
    });

    if (!response.ok) {
      throw new Error("Failed to accept invite");
    }
  }

  async acceptCurrentInvites(): Promise<void> {
    const invites = [...this.manager.pendingInvites];
    for (const invite of invites) {
      await this.processInvite(invite);
    }
    this.manager.pendingInvites = [];
  }

  async checkIncomingMessages(groupId?: GroupId): Promise<ConvoMessage[]> {
    if (!this.serverAddress) {
      throw new Error("Server address is not set");
    }

    let index = 0;
    if (groupId) {
      const group = this.manager.groups.get(Buffer.from(groupId).toString('hex'));
      if (group) {
        index = group.globalIndex;
      }
    }

    const response = await fetch(`${this.serverAddress}/api/get_new_messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        group_id: groupId ? Array.from(groupId) : null,
        sender_id: this.userId,
        index
      })
    });

    const messages: ConvoMessage[] = await response.json();
    const filteredMessages = messages.filter(msg => msg.senderId !== this.userId);

    this.manager.processConvoMessages(filteredMessages, groupId);
    return filteredMessages;
  }

  async syncGroup(groupId: GroupId): Promise<void> {
    await this.checkIncomingMessages(groupId);
    const groupIndex = await this.getGroupIndex(groupId);

    const group = this.manager.groups.get(Buffer.from(groupId).toString('hex'));
    if (group && groupIndex !== group.globalIndex) {
      group.globalIndex = groupIndex;
    }
  }

  async sendMessage(groupId: GroupId, text: string): Promise<void> {
    await this.syncGroup(groupId);

    const msg = this.manager.createMessage(groupId, text);
    const group = this.manager.getGroup(groupId);

    if (!group || !this.serverAddress) {
      throw new Error("Group not found or server address not set");
    }

    const response = await fetch(`${this.serverAddress}/api/send_message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        group_id: Array.from(groupId),
        sender_id: this.userId,
        message: Array.from(msg),
        global_index: group.globalIndex + 1
      })
    });

    if (response.ok) {
      group.globalIndex += 1;
      group.decrypted.push({
        text,
        senderId: this.userId,
        timestamp: Date.now()
      });
    } else {
      group.decrypted.push({
        text: "<message_failed to send!>",
        senderId: this.userId,
        timestamp: Date.now()
      });
    }
  }

  getGroupMessages(groupId: GroupId): MessageItem[] {
    const group = this.manager.getGroup(groupId);
    if (!group) {
      throw new Error("Group not found");
    }
    return group.decrypted;
  }

  getRenderableMessages(groupId: GroupId): string[] {
    const messages = this.getGroupMessages(groupId);
    return messages.map(msg => {
      const senderName = this.idToName.get(msg.senderId) || msg.senderId;
      return `${senderName}: ${msg.text}`;
    });
  }

  private async getGroupIndex(groupId: GroupId): Promise<number> {
    if (!this.serverAddress) {
      throw new Error("Server address is not set");
    }

    const response = await fetch(`${this.serverAddress}/api/group_index`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        group_id: Array.from(groupId),
        sender_id: this.userId
      })
    });

    return await response.json();
  }

  private findGroupIdByName(groupName: string): GroupId {
    // for (const [idHex, group] of this.manager.groups) {
    //   if (group.name === groupName) {
    //     return new Uint8Array(Buffer.from(idHex, 'hex'));
    //   }
    // }
    throw new Error("Group not found");
  }

  nameToId(userName: string): string {
    for (const [id, name] of this.idToName) {
      if (name === userName) {
        return id;
      }
    }
    throw new Error("User not found");
  }
}
