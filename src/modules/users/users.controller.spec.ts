import { AuthenticatedRequest, UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let service: {
    update: jest.MockedFunction<UsersService['update']>;
  };

  beforeEach(() => {
    service = {
      update: jest.fn(),
    };
    controller = new UsersController(service as unknown as UsersService);
  });

  it('passes the authenticated user id to the update service', () => {
    service.update.mockReturnValue({ userId: 'user-1', alias: 'new-alias' });
    const request = {
      user: { userId: 'user-1' },
    } as unknown as AuthenticatedRequest;

    const result: unknown = controller.update(
      'user-1',
      { alias: 'new-alias' },
      request,
    );

    expect(result).toEqual({ userId: 'user-1', alias: 'new-alias' });
    expect(service.update).toHaveBeenCalledWith(
      'user-1',
      { alias: 'new-alias' },
      'user-1',
    );
  });

  it('falls back to id when a strategy exposes req.user.id', () => {
    const request = {
      user: { id: 'user-1' },
    } as unknown as AuthenticatedRequest;

    controller.update('user-1', { alias: 'new-alias' }, request);

    expect(service.update).toHaveBeenCalledWith(
      'user-1',
      { alias: 'new-alias' },
      'user-1',
    );
  });
});
