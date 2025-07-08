import { DateTime } from 'luxon'


export default class ServerShard {

  declare id: number

  declare createdAt: DateTime


  declare updatedAt: DateTime


  declare domain: string


  /**
   * Is the server paired, as in paired?
   */
  declare paired: boolean




  declare isUp: boolean


  declare spaceTotal: number


  declare spaceFree: number


  declare lastHeartbeat: DateTime


}