
#include <bits/stdc++.h>
using namespace std;
#define endl '\n'

int main()
{
    ios_base::sync_with_stdio(0);
    cin.tie(0);

    int t;
    cin >> t;

    while (t--)
    {
        int n;
        cin >> n;

        string s;
        cin >> s;

        int l = 0, r = n - 1, ans = 0;

        while (l < r)
        {
            if (s[l] == s[r])
            {
                l++;
                r--;
            }
            else if (s[l] > s[r])
            {
                s[l]--;
                ans++;
            }
            else
            {
                s[r]--;
                ans++;
            }
        }

        cout << ans << endl;
    }

    return 0;
}
