import { BehaviorSubject } from "rxjs";
import { differenceInMinutes } from 'date-fns';
import { SessionKeys } from "../../interfaces/capital-com.interfaces";
import { EnvConfig } from "../../env-config";
import axios, { AxiosResponse } from "axios";
import { injectable } from "inversify";

@injectable()
export class CapitalComSession  {
  private SESSION_LIFETIME_MINUTES = 9;
  public session$ = new BehaviorSubject<SessionKeys>({
    CST: '',
    X_SECURITY_TOKEN: '',
  });
  private sessionStartTime: number = 0;

  constructor(
    private envConfig: EnvConfig,
  ) {}

  public async renewSession(): Promise<void> {
    const session: AxiosResponse<SessionKeys> = await axios.post(
      `${this.envConfig.CAPITAL_COM_URL}api/v1/session`,
      {
        identifier: this.envConfig.CAPITAL_COM_IDENTIFIER,
        password: this.envConfig.CAPITAL_COM_CUSTOM_PASS,
      },
      {
        headers: {
          'X-CAP-API-KEY': this.envConfig.CAPITAL_COM_API_KEY,
        },
      }
    );

    this.sessionStartTime = Date.now();
    this.session$.next({
      CST: session.headers['cst'],
      X_SECURITY_TOKEN: session.headers['x-security-token'],
    });
  }

  public async checkAndRenewSession(): Promise<void> {
    if (
      !this.session$.getValue().CST ||
      !this.session$.getValue().X_SECURITY_TOKEN ||
      differenceInMinutes(new Date(), new Date(this.sessionStartTime)) >=
        this.SESSION_LIFETIME_MINUTES
    ) {
      await this.renewSession();
    }
  }
}
