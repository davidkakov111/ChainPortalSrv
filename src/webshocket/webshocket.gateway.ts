import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JobProcessor } from '../shared/job.processor';

// Webshocket gateway to handle websocket connections
@WebSocketGateway({
  cors: {
    origin: ['http://localhost:4200'], // TODO - Allow production origin also
  },
})
export class WebshocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(private jobProcessor: JobProcessor) {}

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log('Client connected:', client.id);
  }

  handleDisconnect(client: Socket) {
    console.log('Client disconnected:', client.id);
  }

  // NFT mint websocket endpoint
  @SubscribeMessage('mint-nft')
  async handleNftMintRequest(@ConnectedSocket() client: Socket, @MessageBody() data: any): Promise<void> {
    try {
      // Create a function to emit status updates to the client
      const emitStatus = (message: string) => {
        if (client.connected) client.emit('mint-nft-status', message);
      };

      // Start the job processing (in the backround, independent of the client connection for security)
      await this.jobProcessor.handleNftMintingJob(emitStatus, data);
      
      client.disconnect();
    } catch (error) {
      console.error('Error processing NFT mint webshocket request:', error);
      client.emit('mint-nft-error', 'Minting process failed');
      client.disconnect();
    }
  }
}
