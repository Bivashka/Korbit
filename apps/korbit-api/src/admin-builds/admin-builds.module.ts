import { Module } from '@nestjs/common';
import { AdminBuildsController } from './admin-builds.controller';
import { AdminBuildsService } from './admin-builds.service';

@Module({
  controllers: [AdminBuildsController],
  providers: [AdminBuildsService],
})
export class AdminBuildsModule {}

