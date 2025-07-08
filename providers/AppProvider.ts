import TranscodeService from '#services/TranscodeService'
import type { ApplicationService } from '@adonisjs/core/types'
 
export default class AppProvider {
  constructor(protected app: ApplicationService) {

  }

 

  public async boot() {
    // IoC container is ready
  }

  public async ready() {
    // App is ready
    if (this.app.getEnvironment() === 'web') {
     TranscodeService.start();
    }
  }

  public async shutdown() {
    // Cleanup, etc
  }
  
}
