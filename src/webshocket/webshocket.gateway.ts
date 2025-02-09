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
import { blockchainSymbols } from 'src/shared/types';
import { NftMetadata, TokenMetadata } from 'src/shared/interfaces';

// Webshocket gateway to handle websocket connections
@WebSocketGateway({
  cors: {
    origin: ['http://localhost:4200'], // TODO - Allow production origin also , 'https://chainportal.vercel.app'
  },
  maxHttpBufferSize: 1e8, // 100 MB
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
  async handleNftMintRequest(
    @ConnectedSocket() client: Socket, 
    @MessageBody() data: {bChainSymbol: blockchainSymbols, paymentTxSignature: string, NftMetadata: NftMetadata}
  ): Promise<void> {
    try {
      // Create functions to emit status updates to the client
      const emitStatus = (message: any) => {
        if (client.connected) client.emit('mint-nft-status', message);
      };
      const emitError = (errorMessage: any) => {
        if (client.connected) client.emit('mint-nft-error', errorMessage);
      };
      
      // Start the job processing (in the backround, independent of the client connection for security)
      await this.jobProcessor.handleNftMintingJob(emitStatus, emitError, data);
      
      client.disconnect();
    } catch (error) {
      console.error('Error processing NFT mint webshocket request:', error);
      client.emit('mint-nft-error', 'Minting process failed');
      client.disconnect();
    }
  }

  // Token mint websocket endpoint
  @SubscribeMessage('mint-token')
  async handleTokenMintRequest(
    @ConnectedSocket() client: Socket, 
    @MessageBody() data: {bChainSymbol: blockchainSymbols, paymentTxSignature: string, TokenMetadata: TokenMetadata},
  ): Promise<void> {
    try {
      // Create functions to emit status updates to the client
      const emitStatus = (message: any) => {
        if (client.connected) client.emit('mint-token-status', message);
      };
      const emitError = (errorMessage: any) => {
        if (client.connected) client.emit('mint-token-error', errorMessage);
      };
      
      // Start the job processing (in the backround, independent of the client connection for security)
      await this.jobProcessor.handleTokenMintingJob(emitStatus, emitError, data);
      
      client.disconnect();
    } catch (error) {
      console.error('Error processing Token mint webshocket request:', error);
      client.emit('mint-token-error', 'Minting process failed');
      client.disconnect();
    }
  }
}
