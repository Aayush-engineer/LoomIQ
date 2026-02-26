import { BaseRepository } from './BaseRepository';
import { Task } from '../entities/Task';
import { FindManyOptions, In } from 'typeorm';

export class TaskRepository extends BaseRepository<Task> {
  constructor() {
    super(Task);
  }

  async findByProject(projectId: string): Promise<Task[]> {
    return this.repository.find({
      where: { projectId },
      relations: ['assignedAgent', 'createdBy'],
      order: { createdAt: 'DESC' }
    });
  }

  async findByOrganization(organizationId: string | null, options?: {
    status?: string;
    type?: string;
    priority?: string;
    limit?: number;
  }): Promise<Task[]> {
    const qb = this.repository.createQueryBuilder('task')
      .leftJoinAndSelect('task.project', 'project')
      .leftJoinAndSelect('task.assignedAgent', 'assignedAgent')
      .leftJoinAndSelect('task.createdBy', 'createdBy');

    // Only filter by org when a real UUID is provided
    if (organizationId) {
      qb.where('task.organizationId = :organizationId', { organizationId });
    }

    if (options?.status)   qb.andWhere('task.status = :status',     { status: options.status });
    if (options?.type)     qb.andWhere('task.type = :type',         { type: options.type });
    if (options?.priority) qb.andWhere('task.priority = :priority', { priority: options.priority });
    if (options?.limit)    qb.limit(options.limit);

    return qb.orderBy('task.createdAt', 'DESC').getMany();
  }

  async findPendingTasks(organizationId: string | null): Promise<Task[]> {
    const qb = this.repository.createQueryBuilder('task')
      .leftJoinAndSelect('task.project', 'project')
      .leftJoinAndSelect('task.assignedAgent', 'assignedAgent')
      .where('task.status = :status', { status: 'pending' });

    // Only filter by org when a real UUID is provided
    if (organizationId) {
      qb.andWhere('task.organizationId = :organizationId', { organizationId });
    }

    return qb
      .orderBy('task.priority', 'ASC')
      .addOrderBy('task.createdAt', 'ASC')
      .getMany();
  }

  async findTasksWithDependencies(taskIds: string[]): Promise<Task[]> {
    if (taskIds.length === 0) return [];
    return this.repository.find({
      where: { id: In(taskIds) },
      relations: ['assignedAgent', 'project']
    });
  }

  async findByAgent(agentId: string, status?: string): Promise<Task[]> {
    const where: any = { assignedAgentId: agentId };
    if (status) where.status = status;
    return this.repository.find({
      where,
      relations: ['project', 'createdBy'],
      order: { createdAt: 'DESC' }
    });
  }

  async updateTaskStatus(taskId: string, status: string, updates?: {
    output?: any;
    error?: string;
    actualDuration?: number;
    startedAt?: Date;
    completedAt?: Date;
  }): Promise<Task | null> {
    const updateData: any = { status, updatedAt: new Date() };

    if (updates?.output !== undefined)        updateData.output = updates.output;
    if (updates?.error !== undefined)         updateData.error = updates.error;
    if (updates?.actualDuration !== undefined) updateData.actualDuration = updates.actualDuration;
    if (updates?.startedAt !== undefined)     updateData.startedAt = updates.startedAt;
    if (updates?.completedAt !== undefined)   updateData.completedAt = updates.completedAt;

    await this.repository.update(taskId, updateData);
    return this.findById(taskId);
  }

  async getTaskStatistics(organizationId: string | null): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
  }> {
    const tasks = await this.findByOrganization(organizationId);
    const stats = {
      total: tasks.length,
      byStatus: {} as Record<string, number>,
      byType:   {} as Record<string, number>,
      byPriority: {} as Record<string, number>
    };
    tasks.forEach(task => {
      stats.byStatus[task.status]     = (stats.byStatus[task.status] || 0) + 1;
      stats.byType[task.type]         = (stats.byType[task.type] || 0) + 1;
      stats.byPriority[task.priority] = (stats.byPriority[task.priority] || 0) + 1;
    });
    return stats;
  }

  async findSubtasks(parentTaskId: string): Promise<Task[]> {
    return this.repository.find({
      where: { parentTaskId },
      relations: ['assignedAgent'],
      order: { createdAt: 'ASC' }
    });
  }

  async searchTasks(query: string, organizationId: string | null): Promise<Task[]> {
    const qb = this.repository.createQueryBuilder('task')
      .andWhere('(task.title ILIKE :query OR task.description ILIKE :query)', { query: `%${query}%` })
      .leftJoinAndSelect('task.project', 'project')
      .leftJoinAndSelect('task.assignedAgent', 'agent')
      .orderBy('task.createdAt', 'DESC')
      .limit(50);

    if (organizationId) {
      qb.where('task.organizationId = :organizationId', { organizationId });
    }

    return qb.getMany();
  }
}